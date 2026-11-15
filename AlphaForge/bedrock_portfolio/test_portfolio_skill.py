"""Portfolio invariants, optional notebook parity, and legacy contract checks."""
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

    @unittest.skipUnless((ROOT/'notebook_outputs/portfolio_weights.csv').exists() and
                         (ROOT/'notebook_outputs/portfolio_comparison.csv').exists(),
                         'Optional notebook reference outputs are not included')
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

    @unittest.skipUnless((ROOT/'notebook_outputs/asset_indicators.csv').exists(),
                         'Optional notebook reference outputs are not included')
    def test_indicators_match_notebook(self):
        result = skill.run({'operation': 'indicators'})
        actual = pd.DataFrame(result['indicators']).set_index('ticker')
        expected = pd.read_csv(ROOT/'notebook_outputs/asset_indicators.csv', index_col=0)
        np.testing.assert_allclose(actual.loc[expected.index,expected.columns], expected, atol=1e-8)

    def test_historical_metrics_use_fit_window_and_serialize(self):
        from portfolio_analytics import HISTORICAL_KEYS
        for name, result in self.results.items():
            with self.subTest(profile=name):
                analytics = result['historical_analytics']
                self.assertEqual(analytics['end_date'], result['provenance']['fit_date'])
                self.assertEqual(analytics['observations'], result['provenance']['training_returns'])
                self.assertEqual(analytics['label'], 'Hypothetical Historical Reconstruction')
                self.assertTrue(all(point['date'] <= analytics['end_date'] for point in analytics['history']))
                self.assertTrue(all(np.isfinite(result['metrics'][key]) for key in HISTORICAL_KEYS))
                self.assertEqual(analytics['unavailable_reasons'], {})
                self.assertEqual(result['asset_classes']['CASH'], 'cash')
                json.dumps(result, allow_nan=False)

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

    def test_presets_are_verified(self):
        for name, result in self.results.items():
            with self.subTest(profile=name):
                self.assertEqual(result['status'], 'optimal')
                self.assertAlmostEqual(sum(result['weights'].values()), 1, places=6)
                self.assertTrue(all(c['slack'] >= -skill.TOL for c in result['constraint_checks']))
                json.dumps(result, allow_nan=False)

    def test_tool_invalid_and_infeasible(self):
        self.assertEqual(skill.portfolio_analysis('{broken')['status'], 'invalid_input')
        result = skill.portfolio_analysis(json.dumps({
            'profile': 'Custom', 'constraints': {'cash_min': .8, 'bond_min': .3}}))
        self.assertEqual(result['status'], 'infeasible')
        self.assertNotIn('weights', result)

    def test_dependency_failure_is_sanitized(self):
        with patch.object(skill, 'run', side_effect=RuntimeError('missing data')), self.assertLogs(level='ERROR'):
            result = skill.portfolio_analysis('{}')
        self.assertEqual(result['status'], 'error')
        self.assertNotIn('missing data', json.dumps(result))

    def test_latest_date_and_preset_override(self):
        result = skill.run({'profile':'Balanced','as_of':'2026-11-12','constraints':{'crypto_max':0}})
        self.assertEqual(result['provenance']['fit_date'],'2026-11-12')
        self.assertEqual(result['constraints']['crypto_max'],0)
        self.assertEqual(result['constraints']['bond_min'],.25)


if __name__ == '__main__':
    unittest.main()
