"""Regression against saved notebook outputs plus Bedrock contract/error checks."""
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
import portfolio_skill as skill

ROOT = Path(__file__).resolve().parent.parent


class PortfolioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = {name: skill.run({'profile': name}) for name in skill.PROFILES if name != 'Custom'}

    def event(self, request):
        event = json.loads((ROOT/'bedrock_portfolio/example_event.json').read_text())
        event['parameters'][0]['value'] = json.dumps(request)
        event['sessionAttributes'] = {'test': 'preserve'}
        return event

    def test_all_six_match_notebook(self):
        weights = pd.read_csv(ROOT/'notebook_outputs/portfolio_weights.csv', index_col=0)
        comparison = pd.read_csv(ROOT/'notebook_outputs/portfolio_comparison.csv', index_col=0)
        for name, result in self.results.items():
            with self.subTest(profile=name):
                self.assertEqual(result['status'], 'optimal')
                self.assertEqual(result['provenance']['fit_date'], '2025-11-12')
                actual = pd.Series(result['weights']).reindex(weights.index)
                np.testing.assert_allclose(actual, weights[name], atol=2e-6, rtol=0)
                self.assertAlmostEqual(actual.sum(), 1, places=6)
                self.assertAlmostEqual(result['metrics']['net_monthly_objective']*100,
                                       comparison.loc[name,'net objective %'], places=6)
                self.assertTrue(all(c['slack'] >= -skill.TOL for c in result['constraint_checks']))
                json.dumps(result, allow_nan=False)

    def test_indicators_match_notebook(self):
        result = skill.run({'operation': 'indicators'})
        actual = pd.DataFrame(result['indicators']).set_index('ticker')
        expected = pd.read_csv(ROOT/'notebook_outputs/asset_indicators.csv', index_col=0)
        np.testing.assert_allclose(actual.loc[expected.index,expected.columns], expected, atol=1e-8)

    def test_custom_infeasible_never_relaxes(self):
        result = skill.run({'profile': 'Custom', 'constraints': {'cash_min': .8,'bond_min': .3}})
        self.assertEqual(result['status'], 'infeasible')
        self.assertNotIn('weights', result)
        self.assertEqual(result['constraints'], {'cash_min': .8,'bond_min': .3})

    def test_custom_all_cash_and_previous_holdings(self):
        result = skill.run({'profile': 'Custom', 'constraints': {'cash_min': 1}, 'previous_weights': {}})
        self.assertAlmostEqual(result['weights']['CASH'], 1, places=6)
        self.assertLess(result['metrics']['gross_asset_turnover'], 1e-6)
        self.assertEqual(result['assumptions']['previous_cash'], 1)

    def test_invalid_requests(self):
        requests = [[], {'profile':'unknown'}, {'constraints':{'volatility':.1}},
                    {'constraints':{'vol_max':15}}, {'constraints':{'cash_min':True}},
                    {'constraints':{'crypto_max':float('nan')}}, {'shrink':float('inf')},
                    {'as_of':'2025-02-30'}, {'as_of':'2027-01-01'}, {'as_of':'2021-11-20'},
                    {'previous_weights':{'CASH':1}}, {'previous_weights':{'SPY':.8,'GLD':.3}},
                    {'data_dir':'/tmp'}, {'constraints':None}]
        for request in requests:
            with self.subTest(request=request), self.assertRaises(skill.InputError):
                skill.run(request)
        for value in ['{"kappa":NaN}', '{"profile":"Balanced","profile":"Defensive"}', '{broken']:
            with self.assertRaises(skill.InputError):
                skill.parse_json(value)

    def test_bedrock_response_and_session(self):
        event = self.event({'profile':'Balanced'})
        result = skill.lambda_handler(event, None)
        body = result['response']['functionResponse']
        self.assertNotIn('responseState', body)
        self.assertEqual(result['sessionAttributes'], {'test':'preserve'})
        self.assertEqual(result['response']['function'], 'portfolio_analysis')
        self.assertEqual(json.loads(body['responseBody']['TEXT']['body'])['status'], 'optimal')

    def test_bedrock_reprompt_invalid_and_infeasible(self):
        for request in [{'constraints':{'unknown':0}},
                        {'profile':'Custom','constraints':{'cash_min':.8,'bond_min':.3}}]:
            result = skill.lambda_handler(self.event(request), None)
            self.assertEqual(result['response']['functionResponse']['responseState'], 'REPROMPT')

    def test_dependency_failure_is_failure(self):
        with patch.object(skill, 'run', side_effect=RuntimeError('missing data')), self.assertLogs(level='ERROR'):
            result = skill.lambda_handler(self.event({}), None)
        body = result['response']['functionResponse']
        self.assertEqual(body['responseState'], 'FAILURE')
        self.assertNotIn('missing data',body['responseBody']['TEXT']['body'])

    def test_latest_date_and_preset_override(self):
        result = skill.run({'profile':'Balanced','as_of':'2026-11-12','constraints':{'crypto_max':0}})
        self.assertEqual(result['provenance']['fit_date'],'2026-11-12')
        self.assertEqual(result['constraints']['crypto_max'],0)
        self.assertEqual(result['constraints']['bond_min'],.25)


if __name__ == '__main__':
    unittest.main()
