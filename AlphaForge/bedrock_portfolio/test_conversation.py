"""Real Strands + AgentCore session integration; only AWS transports are fake."""
import copy
import json
import os
import unittest
import uuid
from unittest.mock import patch, MagicMock
from datetime import datetime, timedelta, timezone

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
import main
import conversation


class MemoryTransport:
    def __init__(self):
        self.meta = MagicMock(region_name="us-east-1")
        self.events = []
        self.fail_read = False
        self.fail_agent_read = False
        self.fail_history_read = False
        self.fail_write = False
        self.model_requests = []
        self.content = [{'text': 'Simulation response.'}]

    def create_event(self, **kw):
        if self.fail_write:
            raise RuntimeError('private failure')
        event = copy.deepcopy(dict(kw, eventId=str(uuid.uuid4())))
        self.events.append(event)
        return {'event': event}

    def list_events(self, **kw):
        filters = kw.get('filter', {}).get('eventMetadata', [])
        if self.fail_read or (self.fail_agent_read and any(
                f['right']['metadataValue'].get('stringValue') == 'AGENT' for f in filters)) or (
                self.fail_history_read and not filters):
            raise RuntimeError('private failure')
        events = [e for e in reversed(self.events) if all(
            e[k] == kw[k] for k in ['memoryId', 'actorId', 'sessionId'])]
        for f in kw.get('filter', {}).get('eventMetadata', []):
            events = [e for e in events if e.get('metadata', {}).get(
                f['left']['metadataKey']) == f['right']['metadataValue']]
        start = int(kw.get('nextToken', 0))
        page = events[start:start + 2]  # Exercise SDK pagination on every restore.
        result = {'events': copy.deepcopy(page)}
        if start + 2 < len(events):
            result['nextToken'] = str(start + 2)
        return result

    def converse(self, **kw):
        self.model_requests.append(copy.deepcopy(kw))
        content, self.content = self.content, [{'text': 'Simulation response.'}]
        return {'output': {'message': {'role': 'assistant', 'content': content}},
                'stopReason': 'tool_use' if 'toolUse' in content[0] else 'end_turn',
                'usage': {'inputTokens': 1, 'outputTokens': 1, 'totalTokens': 2},
                'metrics': {'latencyMs': 1}}


class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.transport = MemoryTransport()
        self.env = patch.dict(os.environ, {
            'AWS_ACCESS_KEY_ID': 'test', 'AWS_SECRET_ACCESS_KEY': 'test',
            'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_REGION': 'us-east-1',
            'BEDROCK_MODEL_ID': 'test', 'AGENTCORE_MEMORY_ID': 'test-memory'})
        self.env.start()
        self.addCleanup(self.env.stop)
        # Session/client constructors remain real; every AWS request hits this fake.
        client = patch('boto3.session.Session.client', return_value=self.transport)
        client.start()
        self.addCleanup(client.stop)
        auth = patch.object(main, 'authenticated_actor', side_effect=lambda token: token)
        auth.start()
        self.addCleanup(auth.stop)
        self.session = str(uuid.uuid4())

    def call(self, previous=None, actor='alice', **extra):
        payload = dict(prompt='Update my portfolio.', identity_token=actor, session_id=self.session)
        payload.update({'revision': previous['revision']} if previous else {'new_conversation': True})
        payload.update(extra)
        return main.invoke(payload)

    def test_restore_and_update_one_constraint(self):
        first = self.call(confirmed_constraints={'crypto_max': 0, 'cash_min': .2, 'vol_max': .08})
        self.assertEqual(first['status'], 'ok', first)
        second = self.call(first, confirmed_constraints={'cash_min': .3})
        self.assertEqual(second['status'], 'ok', second)
        self.assertEqual(second['confirmed_constraints'], {'crypto_max': 0, 'cash_min': .3, 'vol_max': .08})
        self.assertGreater(len(self.transport.model_requests[-1]['messages']), 1)
        third = self.call(second, confirmed_constraints={'vol_max': None})
        self.assertEqual(third['confirmed_constraints'], {'crypto_max': 0, 'cash_min': .3})

    def test_user_and_session_isolation_and_new_conversation(self):
        first = self.call(confirmed_constraints={'crypto_max': 0})
        other = self.call(actor='bob')
        self.assertEqual(other['confirmed_constraints'], {})
        self.assertEqual(self.call(first)['confirmed_constraints'], {'crypto_max': 0})
        self.session = str(uuid.uuid4())
        self.assertEqual(self.call()['confirmed_constraints'], {})

    def test_proposal_is_not_confirmation(self):
        self.transport.content = [{'toolUse': {'toolUseId': 'p1', 'name': 'propose_constraints',
            'input': {'patch_json': '{"cash_min":0.4}'}}}]
        first = self.call(confirmed_constraints={'crypto_max': 0})
        self.assertEqual(first['confirmed_constraints'], {'crypto_max': 0})
        self.assertEqual(first['proposed_constraints'], {'cash_min': .4})
        restored = self.call(first)
        self.assertEqual(restored['proposed_constraints'], {'cash_min': .4})
        final = self.call(restored, confirm_proposal=True)
        self.assertEqual(final['confirmed_constraints'], {'crypto_max': 0, 'cash_min': .4})

    def test_rejection_is_deterministic_and_preserves_confirmed_limits(self):
        self.transport.content = [{'toolUse': {'toolUseId': 'p-reject', 'name': 'propose_constraints',
            'input': {'patch_json': '{"cash_min":0.4}'}}}]
        first = self.call(confirmed_constraints={'crypto_max': 0, 'cash_min': .2})
        calls = len(self.transport.model_requests)
        result = self.call(first, reject_proposal=True)
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['confirmed_constraints'], {'crypto_max': 0, 'cash_min': .2})
        self.assertIsNone(result['proposed_constraints'])
        self.assertEqual(len(self.transport.model_requests), calls)
        self.assertEqual(self.call(result)['status'], 'ok')
        self.assertEqual(self.call(result, reject_proposal=True, confirm_proposal=True)['status'], 'invalid_input')

    def test_structured_results_are_actual_tool_output(self):
        self.transport.content = [{'toolUse': {'toolUseId': 'opt', 'name': 'portfolio_analysis',
            'input': {'request_json': '{"operation":"optimize","profile":"Custom"}'}}}]
        result = self.call(confirmed_constraints={'crypto_max': 0, 'cash_min': .2})
        self.assertEqual(result['protocol_version'], 2)
        portfolio = result['portfolio_results'][0]
        self.assertEqual(portfolio['status'], 'optimal')
        self.assertEqual(portfolio['constraints'], result['confirmed_constraints'])
        self.assertIn('CASH', portfolio['weights'])

    def test_missing_expired_stale_and_failed_memory_stop_model(self):
        first = self.call(confirmed_constraints={'crypto_max': 0})
        count = len(self.transport.model_requests)
        self.assertEqual(self.call()['status'], 'conversation_unavailable')
        self.assertEqual(self.call(dict(revision='wrong'))['status'], 'conversation_unavailable')
        self.transport.fail_read = True
        self.assertEqual(self.call(first)['status'], 'conversation_unavailable')
        self.transport.fail_read = False
        self.transport.fail_write = True
        self.assertEqual(self.call(first, confirmed_constraints={'cash_min': .4})['status'], 'conversation_unavailable')
        self.transport.fail_write = False
        self.transport.events.clear()
        self.assertEqual(self.call(first)['status'], 'conversation_unavailable')
        self.assertEqual(len(self.transport.model_requests), count)

    def test_sdk_swallowed_state_and_history_errors_fail_closed(self):
        first = self.call(confirmed_constraints={'crypto_max': 0})
        count = len(self.transport.model_requests)
        self.transport.fail_agent_read = True
        self.assertEqual(self.call(first)['status'], 'conversation_unavailable')
        self.transport.fail_agent_read = False
        self.transport.fail_history_read = True
        self.assertEqual(self.call(first)['status'], 'conversation_unavailable')
        self.assertEqual(len(self.transport.model_requests), count)

    def test_final_write_failure_never_releases_model_answer(self):
        original = self.transport.converse
        def fail_after_model(**kw):
            result = original(**kw)
            self.transport.fail_write = True
            return result
        self.transport.converse = fail_after_model
        result = self.call(confirmed_constraints={'crypto_max': 0})
        self.assertEqual(result['status'], 'conversation_unavailable')
        self.assertNotIn('response', result)
        self.assertNotIn('private failure', json.dumps(result))

    def test_tool_cannot_relax_or_omit_confirmed_limits(self):
        record = {'confirmed': {'crypto_max': 0, 'cash_min': .2}, 'pending': None}
        tool = main.session_tools(record)[0]
        with patch.object(main.portfolio_skill, 'portfolio_analysis', return_value={'status': 'optimal'}) as engine:
            tool('{"operation":"optimize","profile":"Defensive"}')
            self.assertEqual(json.loads(engine.call_args.args[0])['constraints'], record['confirmed'])
            self.assertEqual(json.loads(engine.call_args.args[0])['profile'], 'Custom')
            engine.reset_mock()
            result = tool('{"constraints":{"crypto_max":0.2}}')
            self.assertEqual(result['status'], 'confirmation_required')
            engine.assert_not_called()
        # An inconsistent user-confirmed combination remains infeasible, never relaxed.
        record['confirmed'] = {'cash_min': .8, 'bond_min': .3}
        self.assertEqual(tool('{"profile":"Custom"}')['status'], 'infeasible')

    def test_arbitrary_actor_and_context_mismatch_rejected(self):
        self.assertEqual(self.call(actor_id='someone_else')['status'], 'invalid_input')
        result = main.invoke(dict(prompt='hello', session_id=self.session,
                                 new_conversation=True), MagicMock(session_id='wrong'))
        self.assertEqual(result['status'], 'invalid_input')


class IdentityTests(unittest.TestCase):
    def test_explicit_iam_single_user_mode_uses_only_server_owner(self):
        with patch.dict(os.environ, AUTH_MODE='iam_single_user', SINGLE_USER_ACTOR_ID='owner-123'):
            self.assertEqual(conversation.authenticated_actor(None), 'single-user-owner-123')
            with self.assertRaises(conversation.ConversationError):
                conversation.authenticated_actor('untrusted-token')
        with patch.dict(os.environ, AUTH_MODE='iam_single_user', SINGLE_USER_ACTOR_ID=''):
            with self.assertRaises(conversation.ConversationError):
                conversation.authenticated_actor(None)
        with patch.dict(os.environ, AUTH_MODE='jwt'):
            with self.assertRaises(conversation.ConversationError):
                conversation.authenticated_actor(None)

    def test_signature_issuer_audience_expiry_and_stable_subject(self):
        private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        claims = dict(iss='https://issuer', sub='alice', aud='alphaforge',
                      exp=datetime.now(timezone.utc) + timedelta(minutes=5))
        key = MagicMock(key=private.public_key())
        client = MagicMock()
        client.get_signing_key_from_jwt.return_value = key
        with patch.dict(os.environ, AUTH_ISSUER='https://issuer', AUTH_AUDIENCE='alphaforge',
                        AUTH_JWKS_URL='https://issuer/keys'), patch.object(conversation, 'jwks_client', return_value=client):
            token = jwt.encode(claims, private, algorithm='RS256')
            actor = conversation.authenticated_actor(token)
            self.assertEqual(actor, conversation.authenticated_actor(token))
            for update in [dict(aud='wrong'), dict(iss='https://evil'), dict(exp=1), dict(sub='')]:
                with self.assertRaises(Exception):
                    conversation.authenticated_actor(jwt.encode(claims | update, private, algorithm='RS256'))
            with self.assertRaises(Exception):
                conversation.authenticated_actor(jwt.encode(claims, 'bad-key' * 8, algorithm='HS256'))
            self.assertNotEqual(actor, conversation.authenticated_actor(
                jwt.encode(claims | dict(sub='bob'), private, algorithm='RS256')))


class DeploymentTests(unittest.TestCase):
    def test_web_limits_match_engine(self):
        from pathlib import Path
        import portfolio_skill
        schema = Path(__file__).resolve().parent.parent / 'web/src/lib/constraint-limits.json'
        self.assertEqual(json.loads(schema.read_text()), portfolio_skill.LIMIT_MAX)

    def test_update_request_preserves_existing_configuration(self):
        from prepare_runtime_update import build_update
        from botocore.session import Session
        from botocore.validate import validate_parameters
        current = {
            'agentRuntimeId': 'AlphaForgePortfolio-TevjcpB3OT',
            'roleArn': 'arn:aws:iam::339712771896:role/existing',
            'networkConfiguration': {'networkMode': 'PUBLIC'},
            'protocolConfiguration': {'serverProtocol': 'HTTP'},
            'environmentVariables': {'BEDROCK_MODEL_ID': 'existing-model', 'KEEP': 'yes'},
            'agentRuntimeVersion': '1', 'status': 'READY'}
        env = dict(IMAGE_URI='339712771896.dkr.ecr.us-east-1.amazonaws.com/alphaforge-portfolio:stm-v2',
                   AGENTCORE_MEMORY_ID='memory-1234567890', AUTH_ISSUER='https://issuer',
                   AUTH_AUDIENCE='alphaforge', AUTH_JWKS_URL='https://issuer/keys')
        result = build_update(current, env)
        validate_parameters(result, Session().get_service_model('bedrock-agentcore-control')
                            .operation_model('UpdateAgentRuntime').input_shape)
        self.assertEqual(result['environmentVariables']['KEEP'], 'yes')
        self.assertEqual(result['roleArn'], current['roleArn'])
        self.assertEqual(result['networkConfiguration'], current['networkConfiguration'])
        self.assertNotIn('status', result)
