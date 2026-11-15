import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from unittest.mock import patch
from contextlib import ExitStack

spec = importlib.util.spec_from_file_location('deploy_web', Path(__file__).with_name('deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.config = dict(account='123456789012', region='us-east-1', runtimeId='Test-123', memoryId='Memory-123')
        self.current = dict(agentRuntimeId='Test-123', agentRuntimeArn='arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/Test-123',
            agentRuntimeVersion='2', status='READY', roleArn='arn:aws:iam::123456789012:role/Existing',
            networkConfiguration={'networkMode': 'PUBLIC'}, protocolConfiguration={'serverProtocol': 'HTTP'},
            agentRuntimeArtifact={'containerConfiguration': {'containerUri': '123456789012.dkr.ecr.us-east-1.amazonaws.com/portfolio:old'}},
            environmentVariables={'AGENTCORE_MEMORY_ID': 'Memory-123', 'BEDROCK_MODEL_ID': 'existing-model',
                                  'AUTH_MODE': 'iam_single_user', 'SINGLE_USER_ACTOR_ID': 'local-owner', 'OTHER': 'preserved'})
        self.endpoint = dict(status='READY', liveVersion='2')
        self.memory = dict(status='ACTIVE', strategies=[])

    def test_validates_existing_target(self):
        self.assertEqual(deploy.validate_runtime(self.config, self.current, self.endpoint, self.memory)[1], 'portfolio')
        for field, value in [('status', 'UPDATING'), ('authorizerConfiguration', {'customJWTAuthorizer': {}}),
                             ('agentRuntimeArn', 'wrong-account')]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                deploy.validate_runtime(self.config, {**self.current, field: value}, self.endpoint, self.memory)
        with self.assertRaises(ValueError):
            deploy.validate_runtime(self.config, self.current, {**self.endpoint, 'liveVersion': '1'}, self.memory)

    def test_runtime_update_preserves_role_network_model_and_memory(self):
        output = dict(AuthIssuer='https://issuer', AuthAudience='client', AuthJwksUrl='https://issuer/keys')
        result = deploy.runtime_update(self.current, 'new-image', self.config, output)
        self.assertEqual(result['roleArn'], self.current['roleArn'])
        self.assertEqual(result['networkConfiguration'], self.current['networkConfiguration'])
        env = result['environmentVariables']
        self.assertEqual(env['AUTH_MODE'], 'jwt')
        self.assertEqual(env['AUTH_AUDIENCE'], 'client')
        self.assertEqual(env['BEDROCK_MODEL_ID'], 'existing-model')
        self.assertEqual(env['AGENTCORE_MEMORY_ID'], 'Memory-123')
        self.assertEqual(env['OTHER'], 'preserved')
        self.assertNotIn('SINGLE_USER_ACTOR_ID', env)
        self.assertEqual(self.current['environmentVariables']['AUTH_MODE'], 'iam_single_user')

    def test_analytics_module_is_in_backend_build_context(self):
        root = Path(__file__).resolve().parents[2]
        self.assertIn('!bedrock_portfolio/portfolio_analytics.py', (root / 'bedrock_portfolio/Dockerfile.dockerignore').read_text())

    def test_ready_runtime_must_match_requested_image_and_identity(self):
        deploy.verify_runtime_configuration(self.current, self.current)
        altered = {**self.current, 'environmentVariables': {**self.current['environmentVariables'], 'AUTH_MODE': 'jwt'}}
        with self.assertRaisesRegex(RuntimeError, 'AUTH_MODE'):
            deploy.verify_runtime_configuration(self.current, altered)
        altered = {**self.current, 'agentRuntimeArtifact': {'containerConfiguration': {'containerUri': 'wrong-image'}}}
        with self.assertRaisesRegex(RuntimeError, 'agentRuntimeArtifact'):
            deploy.verify_runtime_configuration(self.current, altered)

    def test_wait_requires_default_endpoint_on_requested_version(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(deploy, 'aws', side_effect=[
            self.current, {**self.endpoint, 'liveVersion': '1'}, self.current, self.endpoint,
        ]) as api, patch.object(deploy.time, 'sleep') as sleep:
            deploy.wait_runtime(self.config, '2', Path(tmp), self.current)
            self.assertEqual(api.call_count, 4)
            sleep.assert_called_once_with(10)

    def test_wait_surfaces_failed_runtime(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(deploy, 'aws', side_effect=[
            {**self.current, 'status': 'UPDATE_FAILED'}, self.endpoint,
        ]), self.assertRaisesRegex(RuntimeError, 'update failed'):
            deploy.wait_runtime(self.config, '2', Path(tmp), self.current)

    def invoke_main(self, mode, fail_build=False, demo=False):
        commands = []
        c = {**self.config, 'stackPrefix': 'AlphaForgeTest', 'domainName': 'portfolio.test.org',
             'hostedZoneId': 'Z123', 'hostedZoneName': 'test.org'}
        if demo:
            for field in ['domainName', 'hostedZoneName', 'hostedZoneId']:
                c.pop(field)
        def command(args, **kwargs):
            args = list(map(str, args))
            commands.append(args)
            if demo and 'diff' in args:
                self.assertEqual(json.loads(deploy.os.environ['ALPHAFORGE_DEPLOY_AZS']), ['us-east-1b', 'us-east-1c'])
            if args[:2] == ['node', '-p']:
                return '24'
            if args[:2] == ['node', '--input-type=module']:
                return json.dumps(c)
            if args[:3] == ['docker', 'buildx', 'build'] and fail_build:
                raise RuntimeError('Build failed')
            return ''
        def api(*args):
            commands.append(['aws', *args])
            if args[0] == 'sts': return {'Account': c['account']}
            if args[1] == 'get-agent-runtime': return self.current
            if args[1] == 'get-agent-runtime-endpoint': return self.endpoint
            if args[1] == 'get-memory': return {'memory': self.memory}
            if args[0] == 'ecr': return {}
            if args[1] == 'describe-availability-zones':
                return {'AvailabilityZones': [
                    {'ZoneName': 'us-east-1a', 'ZoneId': 'use1-az3'},
                    {'ZoneName': 'us-east-1b', 'ZoneId': 'use1-az1'},
                    {'ZoneName': 'us-east-1c', 'ZoneId': 'use1-az2'},
                ]}
            if args[1] == 'describe-managed-prefix-lists':
                return {'PrefixLists': [{'PrefixListId': 'pl-123abc'}]}
            if args[0] == 'route53': return {'HostedZone': {'Name': 'test.org.', 'Config': {'PrivateZone': False}}}
            raise AssertionError(f'Unexpected AWS command {args}')
        with tempfile.TemporaryDirectory() as tmp, ExitStack() as stack:
            config_file = Path(tmp) / 'config.json'
            config_file.write_text(json.dumps(c))
            stack.enter_context(patch.object(deploy, 'HERE', Path(tmp)))
            stack.enter_context(patch.object(deploy, 'run', side_effect=command))
            stack.enter_context(patch.object(deploy, 'aws', side_effect=api))
            stack.enter_context(patch.object(deploy.shutil, 'which', side_effect=lambda tool: None if mode == '--plan' and tool == 'docker' else '/bin/' + tool))
            stack.enter_context(patch.object(deploy.sys, 'argv', ['deploy.py', '--config', str(config_file), *([mode] if mode else [])]))
            stack.enter_context(patch.dict(deploy.os.environ))
            if fail_build:
                with self.assertRaisesRegex(RuntimeError, 'Build failed'):
                    deploy.main()
            else:
                self.assertEqual(deploy.main(), 0)
        return commands

    def test_check_never_calls_aws_or_docker(self):
        commands = self.invoke_main('--check')
        self.assertFalse(any(c[0] in ('aws', 'docker') for c in commands))
        self.assertFalse(any('deploy' in c or 'bootstrap' in c for c in commands))

    def test_plan_does_not_require_docker_or_mutate_cloud(self):
        commands = self.invoke_main('--plan')
        self.assertFalse(any(c[0] == 'docker' for c in commands))
        self.assertFalse(any('deploy' in c or 'bootstrap' in c or 'update-agent-runtime' in c for c in commands))
        self.assertTrue(any('diff' in c and '--no-change-set' in c for c in commands))

    def test_backend_build_failure_prevents_cloud_changes(self):
        commands = self.invoke_main(None, fail_build=True)
        self.assertTrue(any(c[:3] == ['docker', 'buildx', 'build'] for c in commands))
        self.assertFalse(any('deploy' in c or 'bootstrap' in c or 'update-agent-runtime' in c for c in commands))

    def test_demo_plan_skips_route53_and_selects_supported_origin_zones(self):
        commands = self.invoke_main('--plan', demo=True)
        self.assertFalse(any('route53' in c for c in commands))
        self.assertTrue(any('describe-availability-zones' in c for c in commands))
        self.assertTrue(any('describe-managed-prefix-lists' in c for c in commands))
        self.assertFalse(any('deploy' in c or 'bootstrap' in c for c in commands))


if __name__ == '__main__':
    unittest.main()
