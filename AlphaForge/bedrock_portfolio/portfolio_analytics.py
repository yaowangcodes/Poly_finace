"""Historical analytics only; no optimizer inputs or constraints are changed."""
import numpy as np
import pandas as pd


HISTORICAL_KEYS = ('maximum_drawdown', 'sharpe_ratio', 'sortino_ratio',
                   'positive_month_rate', 'worst_monthly_return', 'calmar_ratio',
                   'portfolio_beta')


def historical_cash_returns(annual_rates, price_dates):
    """Effective CAD yield proxy, percent already converted to fractions.

    Accrue each calendar day using only the latest rate strictly before that day.
    Compound across each pair of common price dates, including weekends.
    """
    dates = pd.DatetimeIndex(price_dates)
    calendar = pd.date_range(dates.min(), dates.max(), freq='D')
    rates = annual_rates.sort_index()
    daily = rates.reindex(rates.index.union(calendar)).sort_index().ffill().reindex(calendar).shift(1)
    factors = (1 + daily.where(daily > -1)) ** (1 / 365.25)
    values = []
    for start, end in zip(dates[:-1], dates[1:]):
        interval = factors.loc[(factors.index > start) & (factors.index <= end)]
        values.append(float(interval.prod() - 1) if interval.notna().all() else np.nan)
    return pd.Series(values, index=dates[1:])


def analyze_portfolio(weights, returns, risk_free, benchmark, *, start_date,
                      minimum_acceptable_return=None):
    """Fixed weights rebalanced each common session, before fees/taxes.

    Inputs are dated simple returns in one currency; risk_free and optional MAR
    are per-session returns. Missing observations invalidate affected metrics,
    rather than silently shortening or bridging the evaluation window.
    """
    weights = pd.Series(weights, dtype=float)
    metrics = dict.fromkeys(HISTORICAL_KEYS)
    gross = bool((weights < -1e-10).any())
    metrics['top_five_concentration'] = float(weights.abs().nlargest(5).sum())
    output = {'metrics': metrics, 'unavailable_reasons': {}, 'history': [],
              'label': 'Hypothetical Historical Reconstruction',
              'concentration_label': 'Top 5 Gross Exposure' if gross else 'Top Five Holdings Concentration',
              'observations': len(returns), 'valid_months': 0,
              'start_date': str(pd.Timestamp(start_date).date()),
              'end_date': str(returns.index.max().date()) if len(returns) else None,
              'methodology': 'CAD; fixed optimized weights rebalanced each common session; before costs and taxes. '
                  'Common complete price/FX dates only; missing price dates are excluded before computing returns; crypto uses prior UTC closes. '
                  'Adjusted prices; SPY converted to CAD on the same dates. Cash and risk-free returns compound '
                  'lagged V39079 annual percent rates over actual calendar days (365.25-day year). '
                  'MAR defaults to the same risk-free return. Boundary months are excluded from monthly statistics. '
                  'Weights are fitted on this window: this is not out-of-sample performance.'}
    reasons = output['unavailable_reasons']
    def unavailable(keys, reason):
        reasons.update({key: reason for key in keys})
    if not returns.index.is_unique or not returns.index.is_monotonic_increasing:
        raise ValueError('Returns require unique, increasing dates.')
    held = weights.index[weights != 0]
    aligned = returns.reindex(columns=held)
    if len(returns) < 2 or not np.isfinite(aligned.to_numpy()).all():
        unavailable(HISTORICAL_KEYS, 'At least two complete common-session returns for every holding are required; missing returns are not filled.')
        return output
    rp = aligned @ weights.loc[held]
    years = (returns.index[-1] - pd.Timestamp(start_date)).days / 365.25
    if years <= 0 or (rp <= -1).any():
        unavailable(HISTORICAL_KEYS, 'A positive evaluation span and portfolio returns greater than -100% are required.')
        return output
    ann = len(rp) / years
    wealth = pd.Series(np.r_[1., np.cumprod(1 + rp)], index=[pd.Timestamp(start_date), *rp.index])
    drawdown = wealth / wealth.cummax() - 1
    mdd = float(drawdown.min())
    metrics['maximum_drawdown'] = mdd
    if abs(mdd) > 1e-12:
        metrics['calmar_ratio'] = float((wealth.iloc[-1] ** (1 / years) - 1) / abs(mdd))
    else:
        unavailable(['calmar_ratio'], 'No historical drawdown; Calmar has a zero denominator.')
    rf = risk_free.reindex(rp.index)
    mar = rf if minimum_acceptable_return is None else minimum_acceptable_return.reindex(rp.index)
    if minimum_acceptable_return is not None:
        output['methodology'] = output['methodology'].replace('MAR defaults to the same risk-free return.', 'MAR uses the supplied per-session return series.')
    for key, target in [('sharpe_ratio', rf), ('sortino_ratio', mar)]:
        if not np.isfinite(target).all():
            unavailable([key], 'Aligned risk-free or MAR observations are missing; no future rates are filled backwards.')
            continue
        excess = rp - target
        denominator = excess.std(ddof=1) if key == 'sharpe_ratio' else np.sqrt(np.mean(np.minimum(excess, 0) ** 2))
        if denominator > 1e-12:
            metrics[key] = float(np.sqrt(ann) * excess.mean() / denominator)
        else:
            unavailable([key], 'Zero excess-return volatility.' if key == 'sharpe_ratio' else 'No returns below MAR; downside deviation is zero.')
    # Conservatively exclude both boundary months, even if a boundary is a holiday.
    periods = rp.index.to_period('M')
    complete = (periods > pd.Timestamp(start_date).to_period('M')) & (periods < rp.index[-1].to_period('M'))
    monthly = (1 + rp.loc[complete]).groupby(periods[complete]).prod() - 1
    output['valid_months'] = len(monthly)
    if len(monthly):
        metrics['positive_month_rate'] = float((monthly > 0).mean())
        metrics['worst_monthly_return'] = float(monthly.min())
    else:
        unavailable(['positive_month_rate', 'worst_monthly_return'], 'No complete interior calendar months in the evaluation window.')
    bm = benchmark.reindex(rp.index)
    benchmark_wealth = None
    if not np.isfinite(bm).all() or (bm <= -1).any():
        unavailable(['portfolio_beta'], 'Benchmark returns are missing or invalid on the common evaluation dates.')
    elif bm.var(ddof=1) <= 1e-15:
        unavailable(['portfolio_beta'], 'Benchmark variance is zero.')
    else:
        metrics['portfolio_beta'] = float(rp.cov(bm) / bm.var(ddof=1))
    if np.isfinite(bm).all() and (bm > -1).all():
        benchmark_wealth = pd.Series(np.r_[1., np.cumprod(1 + bm)], index=wealth.index)
    # Compact chart payload: month-end observations plus endpoints and exact MDD.
    chart_dates = wealth.groupby(wealth.index.to_period('M')).tail(1).index.union(
        pd.DatetimeIndex([wealth.index[0], drawdown.idxmin()])).sort_values()
    output['maximum_drawdown_date'] = str(drawdown.idxmin().date())
    output['history'] = [{'date': str(date.date()), 'portfolio': float(wealth.loc[date]),
                          'benchmark': float(benchmark_wealth.loc[date]) if benchmark_wealth is not None else None,
                          'drawdown': float(drawdown.loc[date])} for date in chart_dates]
    return output
