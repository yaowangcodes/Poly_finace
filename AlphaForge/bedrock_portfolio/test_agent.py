"""Offline integration tests: real optimizer, mocked Bedrock/LLM boundary."""
import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from starlette.testclient import TestClient
import main
import portfolio_skill as skill

REQUEST = {'operation': 'optimize', 'profile': 'Custom',
           'constraints': {'crypto_max': 0, 'cash_min': .20, 'vol_max': .08}}
PROMPT = ('Build a defensive portfolio with no cryptocurrency, at least 20% cash, '
          'and annual volatility below 8%.')


class AgentTests(unittest.TestCase):
    def test_tool_forwards_explicit_constraints(self):
        with patch.object(skill, 'run', wraps=skill.run) as run:
            result = main.portfolio_analysis(json.dumps(REQUEST))
        run.assert_called_once_with(REQUEST)
        self.assertEqual(result['status'], 'optimal')
        self.assertEqual(result['constraints'], REQUEST['constraints'])
        self.assertGreaterEqual(result['weights']['CASH'], .20 - skill.TOL)
        self.assertLessEqual(result['metrics']['annual_volatility'], .08 + skill.TOL)
        self.assertAlmostEqual(sum(result['weights'].values()), 1, places=6)

    def test_tool_preserves_all_operations(self):
        for request in [{'operation': 'list_profiles'}, {'operation': 'indicators'},
                        {'profile': 'Balanced'}]:
            with self.subTest(request=request):
                self.assertEqual(main.portfolio_analysis(json.dumps(request)), skill.run(request))

    def test_invalid_and_infeasible(self):
        for value in ['{broken', '{"constraints":{"vol_max":NaN}}',
                      '{"constraints":{"unknown":0}}', '[]']:
            self.assertEqual(main.portfolio_analysis(value)['status'], 'invalid_input')
        result = main.portfolio_analysis(json.dumps({
            'profile': 'Custom', 'constraints': {'cash_min': .8, 'bond_min': .3}}))
        self.assertEqual(result['status'], 'infeasible')
        self.assertNotIn('weights', result)

    def test_missing_data_never_substitutes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
                os.environ, {'ALPHAFORGE_DATA_DIR': directory}), self.assertLogs(level='ERROR'):
            result = main.portfolio_analysis(json.dumps(REQUEST))
        self.assertEqual(result['status'], 'error')
        self.assertNotIn('weights', result)
        self.assertNotIn(directory, json.dumps(result))

    def test_real_strands_loop_with_mock_bedrock_transport(self):
        # Exercise actual Strands tool dispatch and result feedback, without AWS calls.
        with patch.dict(os.environ, {
                'AWS_ACCESS_KEY_ID': 'testing', 'AWS_SECRET_ACCESS_KEY': 'testing',
                'AWS_EC2_METADATA_DISABLED': 'true', 'AWS_REGION': 'us-east-1',
                'BEDROCK_MODEL_ID': 'amazon.nova-lite-v1:0'}, clear=True):
            agent = main.create_agent()
        def response(content, reason):
            return {'output': {'message': {'role': 'assistant', 'content': content}},
                    'stopReason': reason, 'usage': {'inputTokens': 10, 'outputTokens': 10, 'totalTokens': 20},
                    'metrics': {'latencyMs': 1}}
        first = response([{'toolUse': {'toolUseId': 'portfolio-1',
                         'name': 'portfolio_analysis',
                         'input': {'request_json': json.dumps(REQUEST)}}}], 'tool_use')
        final = response([{'text': 'Portfolio simulation calculated.'}], 'end_turn')
        with patch.object(agent.model.client, 'converse', side_effect=[first, final]) as converse:
            result = agent(PROMPT)
        self.assertEqual(str(result).strip(), 'Portfolio simulation calculated.')
        self.assertEqual(converse.call_count, 2)
        tool_results = [block['toolResult'] for message in agent.messages
                        for block in message['content'] if 'toolResult' in block]
        self.assertEqual(len(tool_results), 1)
        content = tool_results[0]['content'][0]
        payload = content.get('json') or json.loads(content['text'])
        self.assertEqual(payload['status'], 'optimal')
        self.assertEqual(payload['constraints'], REQUEST['constraints'])
        self.assertIn('CASH', payload['weights'])

    def test_invalid_payload_and_missing_configuration(self):
        with patch.object(main, 'create_agent') as factory:
            for payload in [None, [], {}, {'prompt': ''}, {'prompt': 3},
                            {'prompt': 'x' * 16001}, {'prompt': 'hi', 'data_dir': '/tmp'}]:
                self.assertEqual(main.invoke(payload)['status'], 'invalid_input')
            factory.assert_not_called()
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(main.invoke({'prompt': PROMPT})['status'], 'invalid_input')

    def test_http_contract_without_credentials(self):
        with TestClient(main.app) as client:
            self.assertEqual(client.get('/ping').status_code, 200)
            response = client.post('/invocations', json={'prompt': ''})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['status'], 'invalid_input')

    def test_legacy_lambda_contract(self):
        event = {'messageVersion': '1.0', 'actionGroup': 'AlphaForgePortfolio',
                 'function': 'portfolio_analysis', 'parameters': [
                     {'name': 'request_json', 'type': 'string', 'value': json.dumps(REQUEST)}],
                 'sessionAttributes': {'test': 'preserve'}, 'promptSessionAttributes': {'key': 'value'}}
        result = skill.lambda_handler(event, None)
        self.assertEqual(result['sessionAttributes'], event['sessionAttributes'])
        self.assertEqual(result['promptSessionAttributes'], event['promptSessionAttributes'])
        self.assertEqual(json.loads(result['response']['functionResponse']['responseBody']['TEXT']['body'])['status'], 'optimal')
        event['parameters'][0]['value'] = '{broken'
        result = skill.lambda_handler(event, None)
        self.assertEqual(result['response']['functionResponse']['responseState'], 'REPROMPT')


if __name__ == '__main__':
    unittest.main()
