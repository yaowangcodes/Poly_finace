"""Known-path formulas and unavailable-data behavior for historical analytics."""
import json
import unittest
import numpy as np
import pandas as pd
from portfolio_analytics import analyze_portfolio, historical_cash_returns


class AnalyticsTests(unittest.TestCase):
    def analyze(self, values, benchmark=None, rf=None, weights=None, dates=None):
        dates = pd.to_datetime(dates or ['2024-01-31', '2024-02-15', '2024-02-29', '2024-03-15', '2024-04-01'])
        series = pd.Series(values, index=dates)
        return analyze_portfolio(weights or {'A': 1}, pd.DataFrame({'A': series}),
                                 pd.Series(0., index=dates) if rf is None else rf,
                                 series if benchmark is None else benchmark,
                                 start_date='2024-01-01')

    def test_all_formulas(self):
        r = np.array([.1, -.2, .05, -.1, .03])
        result = self.analyze(r)
        m = result['metrics']
        wealth = np.r_[1, np.cumprod(1 + r)]
        mdd = min(wealth / np.maximum.accumulate(wealth) - 1)
        ann = 5 / (91 / 365.25)
        self.assertAlmostEqual(m['maximum_drawdown'], mdd)
        self.assertAlmostEqual(m['sharpe_ratio'], np.sqrt(ann) * r.mean() / r.std(ddof=1))
        self.assertAlmostEqual(m['sortino_ratio'], np.sqrt(ann) * r.mean() / np.sqrt(np.mean(np.minimum(r, 0)**2)))
        self.assertEqual(result['valid_months'], 2)
        self.assertEqual(m['positive_month_rate'], 0)
        self.assertAlmostEqual(m['worst_monthly_return'], .8 * 1.05 - 1)
        self.assertAlmostEqual(m['calmar_ratio'], (wealth[-1] ** (365.25 / 91) - 1) / abs(mdd))
        self.assertAlmostEqual(m['portfolio_beta'], 1)
        self.assertEqual(m['top_five_concentration'], 1)
        self.assertEqual(min(row['drawdown'] for row in result['history']), mdd)
        json.dumps(result, allow_nan=False)

    def test_initial_loss_is_drawdown(self):
        self.assertAlmostEqual(self.analyze([-.2, 0, 0, 0, 0])['metrics']['maximum_drawdown'], -.2)

    def test_zero_volatility_no_drawdown(self):
        result = self.analyze([0] * 5)
        for key in ['sharpe_ratio', 'sortino_ratio', 'calmar_ratio', 'portfolio_beta']:
            self.assertIsNone(result['metrics'][key])
            self.assertIn(key, result['unavailable_reasons'])
        self.assertEqual(result['metrics']['maximum_drawdown'], 0)
        self.assertEqual(result['metrics']['positive_month_rate'], 0)

    def test_positive_months_and_no_downside(self):
        result = self.analyze([.1, .1, .1, -.1, .1])
        self.assertEqual(result['metrics']['positive_month_rate'], .5)
        result = self.analyze([.01, .02, .03, .04, .05])
        self.assertIsNone(result['metrics']['sortino_ratio'])
        self.assertIsNone(result['metrics']['calmar_ratio'])

    def test_concentration_and_short_label(self):
        dates = pd.date_range('2024-01-02', periods=5)
        returns = pd.DataFrame(0., index=dates, columns=list('ABCDEF'))
        weights = dict(zip('ABCDEF', [.3, .2, .15, .15, .1, .1]))
        args = [returns, pd.Series(0., index=dates), pd.Series(0., index=dates)]
        result = analyze_portfolio(weights, *args, start_date='2024-01-01')
        self.assertAlmostEqual(result['metrics']['top_five_concentration'], .9)
        weights['A'] = -.3
        result = analyze_portfolio(weights, *args, start_date='2024-01-01')
        self.assertEqual(result['concentration_label'], 'Top 5 Gross Exposure')
        self.assertAlmostEqual(result['metrics']['top_five_concentration'], .9)

    def test_missing_and_insufficient(self):
        result = self.analyze([0, np.nan, 0, 0, 0])
        self.assertIsNone(result['metrics']['maximum_drawdown'])
        self.assertTrue(result['unavailable_reasons'])
        result = self.analyze([.1], dates=['2024-01-02'])
        self.assertIsNone(result['metrics']['sharpe_ratio'])
        result = self.analyze([.1, -.1], dates=['2024-01-02', '2024-01-03'])
        self.assertIsNone(result['metrics']['worst_monthly_return'])
        self.assertIsNone(result['metrics']['positive_month_rate'])

    def test_missing_rate_or_benchmark_only_invalidates_affected_metrics(self):
        result = self.analyze([.01, -.02, .03, -.01, .02], rf=pd.Series(dtype=float))
        self.assertIsNone(result['metrics']['sharpe_ratio'])
        self.assertIsNotNone(result['metrics']['maximum_drawdown'])
        result = self.analyze([.01, -.02, .03, -.01, .02], benchmark=pd.Series(dtype=float))
        self.assertIsNone(result['metrics']['portfolio_beta'])
        self.assertIsNotNone(result['metrics']['sharpe_ratio'])

    def test_beta_date_alignment(self):
        dates = pd.to_datetime(['2024-01-31', '2024-02-15', '2024-02-29', '2024-03-15', '2024-04-01'])
        bm = pd.Series([.01, -.02, .03, -.01, .02], index=dates)
        result = self.analyze(bm.to_numpy() * 2, benchmark=bm.iloc[::-1])
        self.assertAlmostEqual(result['metrics']['portfolio_beta'], 2)

    def test_lagged_rates_compound_weekends_without_future_leakage(self):
        dates = pd.to_datetime(['2024-01-05', '2024-01-08', '2024-01-09'])
        rates = pd.Series([.04, .09, .99], index=pd.to_datetime(['2024-01-04', '2024-01-08', '2024-01-10']))
        rf = historical_cash_returns(rates, dates)
        self.assertAlmostEqual(rf.iloc[0], 1.04 ** (3 / 365.25) - 1)
        self.assertAlmostEqual(rf.iloc[1], 1.09 ** (1 / 365.25) - 1)
        changed = rates.copy(); changed.iloc[-1] = .01
        pd.testing.assert_series_equal(rf, historical_cash_returns(changed, dates))

    def test_configured_mar(self):
        dates = pd.date_range('2024-01-02', periods=3)
        r = pd.Series([.01, -.02, .03], index=dates)
        mar = pd.Series(.02, index=dates)
        result = analyze_portfolio({'A': 1}, pd.DataFrame({'A': r}), mar * 0, r,
                                   start_date='2024-01-01', minimum_acceptable_return=mar)
        expected = np.sqrt(365.25) * (r - mar).mean() / np.sqrt(np.mean(np.minimum(r - mar, 0)**2))
        self.assertAlmostEqual(result['metrics']['sortino_ratio'], expected)


if __name__ == '__main__':
    unittest.main()
