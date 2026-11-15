#!/usr/bin/env python3
"""CLI orchestration; uses AWS CLI, never reads or prints raw credentials."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CDK = HERE / 'node_modules/.bin/cdk'


def run(args, *, capture=False, cwd=ROOT, input=None):
    return subprocess.run([str(a) for a in args], cwd=cwd, check=True, text=True,
                          input=input, stdout=subprocess.PIPE if capture else None).stdout


def aws(*args):
    return json.loads(run(['aws', *args, '--output', 'json'], capture=True))


def save(directory, name, value):
    (directory / name).write_text(json.dumps(value, indent=2) + '\n')


def validate_runtime(config, runtime, endpoint, memory):
    expected = f"arn:aws:bedrock-agentcore:{config['region']}:{config['account']}:runtime/{config['runtimeId']}"
    if runtime.get('agentRuntimeArn') != expected:
        raise ValueError('Runtime account/region does not match config.json.')
    if runtime.get('status') != 'READY' or endpoint.get('status') != 'READY':
        raise ValueError('Runtime and DEFAULT endpoint must be READY before deployment.')
    if str(runtime['agentRuntimeVersion']) != str(endpoint.get('liveVersion')):
        raise ValueError('DEFAULT is not on the latest runtime version. Inspect before updating.')
    if runtime.get('authorizerConfiguration'):
        raise ValueError('Expected IAM transport authentication. This script will not change an inbound JWT authorizer.')
    if runtime.get('protocolConfiguration', {}).get('serverProtocol') != 'HTTP':
        raise ValueError('Expected the existing HTTP runtime.')
    if runtime.get('environmentVariables', {}).get('AGENTCORE_MEMORY_ID') != config['memoryId']:
        raise ValueError('Configured memory differs from the runtime. No Memory is created or replaced.')
    if memory.get('status') != 'ACTIVE' or memory.get('strategies'):
        raise ValueError('Expected existing ACTIVE short-term-only Memory.')
    if not runtime.get('environmentVariables', {}).get('BEDROCK_MODEL_ID'):
        raise ValueError('Runtime has no configured model.')
    image = runtime['agentRuntimeArtifact']['containerConfiguration']['containerUri']
    registry = f"{config['account']}.dkr.ecr.{config['region']}.amazonaws.com"
    if not image.startswith(registry + '/'):
        raise ValueError('Expected an ECR backend image in this account and region.')
    repository = image[len(registry) + 1:].split('@')[0].split(':')[0]
    if not repository:
        raise ValueError('Missing backend ECR repository.')
    return registry, repository


def runtime_update(current, image, config, outputs):
    sys.path.insert(0, str(ROOT / 'bedrock_portfolio'))
    from prepare_runtime_update import build_update
    desired = {'IMAGE_URI': image, 'AUTH_MODE': 'jwt', 'AGENTCORE_MEMORY_ID': config['memoryId'],
               'AUTH_ISSUER': outputs['AuthIssuer'], 'AUTH_AUDIENCE': outputs['AuthAudience'],
               'AUTH_JWKS_URL': outputs['AuthJwksUrl']}
    update = build_update(current, desired)
    update['environmentVariables'].pop('SINGLE_USER_ACTOR_ID', None)
    return update


def verify_runtime_configuration(runtime, expected):
    # READY alone does not prove the requested image or application identity is active.
    for key in ['agentRuntimeArtifact', 'roleArn', 'networkConfiguration', 'protocolConfiguration']:
        if runtime.get(key) != expected.get(key):
            raise RuntimeError(f'Runtime is READY but {key} differs from the requested configuration.')
    actual_env = runtime.get('environmentVariables', {})
    for key, value in expected.get('environmentVariables', {}).items():
        if actual_env.get(key) != value:
            raise RuntimeError(f'Runtime is READY but environment setting {key} differs.')


def wait_runtime(config, version, directory, expected, timeout=900):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        runtime = aws('bedrock-agentcore-control', 'get-agent-runtime', '--agent-runtime-id', config['runtimeId'],
                      '--agent-runtime-version', str(version))
        endpoint = aws('bedrock-agentcore-control', 'get-agent-runtime-endpoint', '--agent-runtime-id', config['runtimeId'],
                       '--endpoint-name', 'DEFAULT')
        save(directory, 'runtime-after.json', runtime)
        save(directory, 'endpoint-after.json', endpoint)
        if any('FAILED' in item.get('status', '') for item in (runtime, endpoint)):
            raise RuntimeError('Runtime update failed; inspect saved status files. No automatic runtime rollback was attempted.')
        if runtime['status'] == endpoint['status'] == 'READY' and str(endpoint.get('liveVersion')) == str(version):
            verify_runtime_configuration(runtime, expected)
            return
        print(f'Waiting for runtime version {version} and DEFAULT endpoint...', flush=True)
        time.sleep(10)
    raise TimeoutError('Runtime readiness timed out. Inspect AWS before retrying; update may still be in progress.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--check', action='store_true', help='Validate and synthesize locally; no AWS or Docker calls.')
    modes.add_argument('--plan', action='store_true', help='Read-only AWS preflight and CDK diff; no deployment.')
    parser.add_argument('--config', default=str(HERE / 'config.json'))
    args = parser.parse_args()
    os.umask(0o077)
    config_path = Path(args.config).resolve()
    if not config_path.exists():
        shutil.copyfile(HERE / 'config.example.json', config_path)
        print(f'已生成 {config_path}。填写 AWS 账号和现有后端信息后，重新运行 bash deploy_web.sh。')
        return 2
    for tool in ['node', 'npm']:
        if not shutil.which(tool):
            raise RuntimeError(f'Missing {tool}. Install Node.js 24 and ensure it is on PATH.')
    if int(run(['node', '-p', 'process.versions.node.split(".")[0]'], capture=True).strip()) < 22:
        raise RuntimeError('Node.js 22+ required; Node.js 24 recommended.')
    os.environ['ALPHAFORGE_DEPLOY_CONFIG'] = str(config_path)
    config = json.loads(run(['node', '--input-type=module', '-e',
                            'import {readConfig} from "./config.mjs"; try { console.log(JSON.stringify(readConfig())); } catch (error) { console.log(JSON.stringify({config_error: error instanceof SyntaxError ? "config.json must be valid JSON (quoted keys, no trailing commas)." : error.message})); }'],
                           cwd=HERE, capture=True))
    if 'config_error' in config:
        raise ValueError(f"Invalid deployment configuration: {config['config_error']}")
    os.environ.update(AWS_REGION=config['region'], AWS_DEFAULT_REGION=config['region'], AWS_PAGER='',
                      CDK_DEFAULT_ACCOUNT=config['account'], CDK_DEFAULT_REGION=config['region'],
                      AWS_MAX_ATTEMPTS='1')
    # Fail on concurrent runs, including a second terminal; OS releases lock on interruption.
    with open(HERE / '.deploy.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print('Installing pinned deployment dependencies and synthesizing infrastructure...', flush=True)
        run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], cwd=HERE)
        run([CDK, 'synth', '--strict', '--quiet'], cwd=HERE)
        if args.check:
            print('Local validation passed. No AWS resources changed.')
            return 0
        for tool in (['aws'] if args.plan else ['aws', 'docker']):
            if not shutil.which(tool):
                raise RuntimeError(f'Missing {tool}.')
        print('Checking account, existing runtime, memory and web hosting prerequisites...', flush=True)
        identity = aws('sts', 'get-caller-identity')
        if identity['Account'] != config['account']:
            raise ValueError('Wrong AWS account. No resources changed.')
        runtime = aws('bedrock-agentcore-control', 'get-agent-runtime', '--agent-runtime-id', config['runtimeId'])
        endpoint = aws('bedrock-agentcore-control', 'get-agent-runtime-endpoint', '--agent-runtime-id', config['runtimeId'], '--endpoint-name', 'DEFAULT')
        memory = aws('bedrock-agentcore-control', 'get-memory', '--memory-id', config['memoryId'])['memory']
        registry, repository = validate_runtime(config, runtime, endpoint, memory)
        aws('ecr', 'describe-repositories', '--repository-names', repository)
        deploy_parameters = []
        if config.get('domainName'):
            zone = aws('route53', 'get-hosted-zone', '--id', config['hostedZoneId'])['HostedZone']
            if zone['Name'].rstrip('.') != config['hostedZoneName'] or zone.get('Config', {}).get('PrivateZone'):
                raise ValueError('Route 53 zone must be public and match hostedZoneName.')
        else:
            # AWS documents these AZ IDs as unsupported for VPC origins.
            excluded = {'use1-az3', 'usw1-az2', 'apne1-az3', 'cac1-az3'}
            zones = aws('ec2', 'describe-availability-zones', '--filters', 'Name=state,Values=available')['AvailabilityZones']
            supported = sorted(z['ZoneName'] for z in zones if z.get('ZoneId') not in excluded and z.get('ZoneType', 'availability-zone') == 'availability-zone')
            if len(supported) < 2:
                raise ValueError('CloudFront VPC origins require two available supported AZs for this deployment.')
            os.environ['ALPHAFORGE_DEPLOY_AZS'] = json.dumps(supported[:2])
            lists = aws('ec2', 'describe-managed-prefix-lists', '--filters',
                        'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing')['PrefixLists']
            if len(lists) != 1:
                raise ValueError('AWS CloudFront origin-facing prefix list was not found in this region.')
            deploy_parameters = ['--parameters', f'{config["stackPrefix"]}-Demo:CloudFrontPrefixListId={lists[0]["PrefixListId"]}']
        if args.plan:
            run([CDK, 'diff', '--all', '--no-change-set'], cwd=HERE)
            print('Plan only. Deployment will also rebuild the backend and set AUTH_MODE=jwt on the existing runtime.')
            return 0
        run(['docker', 'info'], capture=True)
        run(['docker', 'buildx', 'version'], capture=True)
        run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + f'-{os.getpid()}'
        directory = HERE / 'runs' / run_id
        directory.mkdir(parents=True)
        save(directory, 'runtime-before.json', runtime)
        sys.path.insert(0, str(ROOT / 'bedrock_portfolio'))
        from prepare_runtime_update import build_update
        previous_env = dict(runtime['environmentVariables'])
        previous_env['IMAGE_URI'] = runtime['agentRuntimeArtifact']['containerConfiguration']['containerUri']
        rollback = build_update(runtime, previous_env)
        rollback['environmentVariables'] = dict(runtime['environmentVariables'])
        save(directory, 'runtime-rollback.json', rollback)
        save(directory, 'endpoint-before.json', endpoint)
        save(directory, 'config.json', config)
        print(f'Deploying to {config["account"]}/{config["region"]}: {config.get("domainName", "AWS-provided CloudFront HTTPS address")}', flush=True)
        print('This creates billable web resources and switches the existing runtime from local single-user to JWT user authentication.', flush=True)
        print(f'Recovery snapshots: {directory}', flush=True)
        print('Building and testing the backend ARM64 image before cloud changes...', flush=True)
        image = f'{registry}/{repository}:web-{run_id}'
        run(['docker', 'buildx', 'build', '--platform', 'linux/arm64', '--provenance=false', '--load',
             '-f', 'bedrock_portfolio/Dockerfile', '-t', image, '.'])
        if run(['docker', 'image', 'inspect', image, '--format', '{{.Architecture}}'], capture=True).strip() != 'arm64':
            raise RuntimeError('Backend image is not ARM64.')
        # Local optimizer smoke check: no credentials, network or model invocation.
        run(['docker', 'run', '--rm', '--network', 'none', image, 'python', '-c',
             'from portfolio_skill import run; r=run({"profile":"Balanced"}); assert r["status"]=="optimal"; '
             'assert r["historical_analytics"]["label"]=="Hypothetical Historical Reconstruction"; '
             'assert r["metrics"]["maximum_drawdown"] is not None; print("Backend image analytics check passed")'])
        # Bootstrap is repeatable and only affects the selected account/region.
        run([CDK, 'bootstrap', f'aws://{config["account"]}/{config["region"]}'], cwd=HERE)
        run([CDK, 'diff', '--all', '--no-change-set'], cwd=HERE)
        outputs_path = directory / 'outputs.json'
        run([CDK, 'deploy', '--all', '--require-approval', 'never', '--outputs-file', outputs_path, *deploy_parameters], cwd=HERE)
        outputs = json.loads(outputs_path.read_text())
        data_outputs = outputs[f'{config["stackPrefix"]}-Data'] if config.get('domainName') else outputs[f'{config["stackPrefix"]}-Demo']
        web_outputs = outputs[f'{config["stackPrefix"]}-Web'] if config.get('domainName') else data_outputs
        print('Publishing the verified backend image...', flush=True)
        password = run(['aws', 'ecr', 'get-login-password'], capture=True)
        run(['docker', 'login', '--username', 'AWS', '--password-stdin', registry], input=password)
        del password
        run(['docker', 'push', image])
        aws('ecr', 'describe-images', '--repository-name', repository, '--image-ids', f'imageTag=web-{run_id}')
        current = aws('bedrock-agentcore-control', 'get-agent-runtime', '--agent-runtime-id', config['runtimeId'])
        if current['agentRuntimeVersion'] != runtime['agentRuntimeVersion']:
            raise RuntimeError('Runtime changed during deployment. Inspect saved snapshots before retrying.')
        update = runtime_update(current, image, config, data_outputs)
        save(directory, 'runtime-update.json', update)
        print('Updating existing AgentCore configuration; IAM transport, execution role and Memory are preserved...', flush=True)
        updated = aws('bedrock-agentcore-control', 'update-agent-runtime', '--cli-input-json', f'file://{directory / "runtime-update.json"}')
        save(directory, 'runtime-updated.json', updated)
        wait_runtime(config, updated['agentRuntimeVersion'], directory, update)
        print('Verifying HTTPS website availability...', flush=True)
        url = web_outputs['WebsiteUrl']
        for attempt in range(30):
            try:
                with urllib.request.urlopen(url + '/api/live', timeout=10) as response:
                    if json.load(response).get('status') != 'ok':
                        raise ValueError('Unexpected liveness response')
                break
            except Exception:
                if attempt == 29:
                    raise RuntimeError('AWS deployment completed, but HTTPS check failed. Check DNS delegation/certificate and ECS logs; do not assume rollback.')
                time.sleep(10)
        print(f'\nDeployment READY: {url}\nCognito user pool: {data_outputs["UserPoolId"]}\nArtifacts: {directory}')
        print('Invite users via Cognito. No invitations or model calls were made. Test login and one optimization before sharing the URL.')
        return 0

if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt) as exc:
        print(f'\nDeployment stopped: {exc}\nNo automatic AgentCore rollback was performed. Inspect infra/web-deploy/runs and CloudFormation before retrying.', file=sys.stderr)
        sys.exit(1)
