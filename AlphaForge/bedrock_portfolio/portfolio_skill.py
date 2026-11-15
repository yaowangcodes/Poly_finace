"""AlphaForge read-only AgentCore portfolio tool; no notebook runtime required.

AgentCore entry point: bedrock_portfolio/main.py
Legacy Lambda handler: portfolio_skill.lambda_handler
Local: python bedrock_portfolio/portfolio_skill.py --request '{"profile":"Balanced"}'
"""
from pathlib import Path
import argparse
import hashlib
import json
import logging
import math
import os
import re

import cvxpy as cp
import numpy as np
import pandas as pd

ALPHA = 0.95
TOL = 2e-6
BASE = dict(position_max=.20, crypto_max=.10, hhi_max=.12)
PROFILES = {
    "Return only": {},
    "Diversified": dict(BASE),
    "Balanced": dict(BASE, cash_min=.05, bond_min=.25, equity_max=.65,
                     vol_max=.15, beta_max=.80, stress_max=.15),
    "Defensive": dict(position_max=.20, crypto_max=0, cash_min=.20, bond_min=.30,
                      equity_max=.40, hhi_max=.10, vol_max=.08, beta_max=.40,
                      cvar_max=.01, downside_max=.06, stress_max=.10),
    "Track SPY": dict(position_max=.35, crypto_max=0, cash_min=.02, te_max=.05),
    "Low turnover": dict(BASE, cash_min=.05, vol_max=.22, turnover_max=.25),
    "Custom": {},
}
LIMIT_MAX = {k: 1.0 for k in ["position_max", "cash_min", "bond_min", "equity_max",
    "crypto_max", "hhi_max", "cvar_max", "stress_max", "usd_max", "canada_min", "gold_min"]}
LIMIT_MAX.update(vol_max=5.0, beta_max=10.0, te_max=5.0, downside_max=5.0, turnover_max=2.0)
WARNINGS = [
    "Generic simulation, not a personalized recommendation or a trade instruction.",
    "Preset constraints and the 50% mean shrinkage are demo assumptions, not confirmed investor requirements.",
    "Historical estimates and fitted risk limits do not guarantee future returns or losses.",
    "The 2026-selected universe and revised adjusted prices retain survivorship and snapshot bias.",
    "Crypto uses prior UTC closes; CAD prices and FX are not synchronized executable quotes.",
    "Listing exposures are not economic or ETF look-through exposures; ESG is not verified.",
    "Cash uses the lagged Canadian overnight rate as an effective-yield proxy; costs exclude tax and market impact.",
]


class InputError(ValueError):
    """A request the agent can correct without retrying infrastructure."""


def number(value, name, upper):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{name} must be a numeric fraction, not a string or boolean.")
    if not math.isfinite(value) or not 0 <= value <= upper:
        raise InputError(f"{name} must be finite and between 0 and {upper}; 20% means 0.20.")
    return float(value)


def validate_request(request):
    if not isinstance(request, dict):
        raise InputError("Request must be a JSON object.")
    allowed = {"operation", "profile", "constraints", "as_of", "kappa", "shrink", "previous_weights"}
    unknown = set(request) - allowed
    if unknown:
        raise InputError(f"Unknown request fields: {sorted(unknown)}")
    result = dict(request)
    operation = result.setdefault("operation", "optimize")
    if operation not in ("optimize", "indicators", "list_profiles"):
        raise InputError("operation must be optimize, indicators, or list_profiles.")
    profile = result.setdefault("profile", "Balanced")
    if not isinstance(profile, str) or profile not in PROFILES:
        raise InputError(f"profile must be one of {list(PROFILES)}")
    constraints = result.setdefault("constraints", {})
    if not isinstance(constraints, dict):
        raise InputError("constraints must be an object of supported numeric limits.")
    if set(constraints) - set(LIMIT_MAX):
        raise InputError(f"Unknown constraints: {sorted(set(constraints)-set(LIMIT_MAX))}; no limits were ignored.")
    result["constraints"] = {k: number(v, k, LIMIT_MAX[k]) for k, v in constraints.items()}
    result["kappa"] = number(result.get("kappa", .001), "kappa", .05)
    result["shrink"] = number(result.get("shrink", .50), "shrink", 1)
    if "as_of" in result:
        value = result["as_of"]
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise InputError("as_of must be YYYY-MM-DD.")
        try:
            pd.Timestamp(value)
        except ValueError as exc:
            raise InputError("as_of is not a valid calendar date.") from exc
    if "previous_weights" in result:
        weights = result["previous_weights"]
        if not isinstance(weights, dict) or not all(isinstance(k, str) for k in weights):
            raise InputError("previous_weights must map asset tickers to fractions; residual is cash.")
        result["previous_weights"] = {k: number(v, f"previous_weights.{k}", 1) for k,v in weights.items()}
        if sum(result["previous_weights"].values()) > 1 + 1e-10:
            raise InputError("previous_weights must sum to at most 1; omit CASH (cash is the residual).")
    return result


def run(request, data_dir=None):
    """Return JSON-compatible results. Only the deployer can set data_dir, not the agent."""
    request = validate_request(request)
    if request["operation"] == "list_profiles":
        return {"status": "ok", "profiles": PROFILES, "constraint_maximum_values": LIMIT_MAX,
                "units": "Fractions: 0.20 = 20%; beta and HHI are unitless.",
                "defaults": {"profile":"Balanced", "kappa":.001, "shrink":.5},
                "warnings": WARNINGS}
    if data_dir is None:
        packaged = Path(__file__).resolve().parent / "alphaforge_starter"
        default = packaged if packaged.is_dir() else Path(__file__).resolve().parent.parent / "alphaforge_starter"
        data_dir = os.environ.get("ALPHAFORGE_DATA_DIR", str(default))
    return _compute(request, Path(data_dir))


def _compute(request, DATA):
    KAPPA, SHRINK = request["kappa"], request["shrink"]
    universe = pd.read_csv(DATA / 'assets_universe.csv').set_index('ticker')
    tickers = universe.index.tolist()
    prices = pd.read_csv(DATA / 'prices_daily.csv', parse_dates=['date'])
    fx = pd.read_csv(DATA / 'fx_usdcad_daily.csv', parse_dates=['date']).set_index('date').sort_index()
    macro = pd.read_csv(DATA / 'macro_rates.csv', parse_dates=['date'])
    actions = pd.read_csv(DATA / 'corporate_actions.csv', parse_dates=['ex_date'])
    sources = pd.read_csv(DATA / 'sources_metadata.csv')
    if len(tickers) != 31 or not universe.index.is_unique or 'SPY' not in tickers:
        raise RuntimeError('Expected the original 31-asset starter universe, including SPY.')
    if prices.duplicated(['date','ticker']).any() or not fx.index.is_unique or macro.duplicated(['date','series_id']).any():
        raise RuntimeError('Duplicate keys in source data.')
    if set(prices.ticker) != set(tickers) or not (prices.currency == prices.ticker.map(universe.currency)).all():
        raise RuntimeError('Asset or currency mapping mismatch.')
    if not np.isfinite(prices.adj_close).all() or not (prices.adj_close>0).all() or not np.isfinite(fx.usdcad).all() or not (fx.usdcad>0).all():
        raise RuntimeError('Non-positive or non-finite prices/FX.')
    local_prices = prices.pivot(index='date', columns='ticker', values='adj_close').reindex(columns=tickers)
    crypto = universe.asset_class.eq('crypto')
    for ticker in universe.index[crypto]:
        # Calendar-date lookup, not a one-row shift on the trading calendar.
        local_prices[ticker] = local_prices[ticker].reindex(local_prices.index - pd.Timedelta(days=1)).to_numpy()
    aligned = local_prices.dropna().index.intersection(fx.index).sort_values()
    cad_prices = local_prices.loc[aligned].copy()
    usd = universe.currency.eq('USD')
    cad_prices.loc[:, usd] = cad_prices.loc[:, usd].mul(fx.loc[aligned, 'usdcad'], axis=0)
    returns = cad_prices.pct_change(fill_method=None).iloc[1:]
    if not np.isfinite(returns.to_numpy()).all() or not (returns > -1).all().all():
        raise RuntimeError('Invalid aligned returns.')
    cutoff = pd.Timestamp(request['as_of']) if 'as_of' in request else cad_prices.index.max() - pd.DateOffset(years=1)
    if cutoff > cad_prices.index.max():
        raise InputError('as_of is later than the available aligned data.')
    train = returns.loc[returns.index <= cutoff]
    if len(train) < 60:
        raise InputError('At least 60 aligned training returns are required at as_of.')
    fit_end = train.index[-1]
    fit_years = (fit_end - cad_prices.index[0]).days / 365.25
    ANN = len(train) / fit_years

    rate = macro.loc[macro.series_id.eq('V39079')].set_index('date').value.sort_index() / 100
    calendar = pd.date_range(cad_prices.index.min(), cad_prices.index.max(), freq='D')
    available_rate = rate.reindex(rate.index.union(calendar)).sort_index().ffill().reindex(calendar).shift(1)
    rf_annual = float(available_rate.loc[fit_end])
    if not np.isfinite(rf_annual) or rf_annual <= -1:
        raise RuntimeError('Missing or invalid lagged cash rate at fit date.')
    rf_month = (1 + rf_annual)**(1/12) - 1
    rf_session = (1 + rf_annual)**(1/ANN) - 1

    R = train.to_numpy()
    n = len(tickers)
    benchmark = train['SPY'].to_numpy()
    mu_month = (SHRINK * train.mean().mean() + (1 - SHRINK) * train.mean()).to_numpy() * ANN / 12
    cov_annual = train.cov().to_numpy() * ANN
    centered = R - R.mean(axis=0)
    if np.var(benchmark) <= 1e-15:
        raise RuntimeError('Benchmark has no usable variance.')
    beta = centered.T @ (benchmark - benchmark.mean()) / np.sum((benchmark - benchmark.mean())**2)

    # Exact empirical expected shortfall, including fractional boundary observation.
    def cvar_loss(r, alpha=ALPHA):
        losses = np.sort(-np.asarray(r))[::-1]
        tail = (1 - alpha) * len(losses)
        k = int(np.floor(tail))
        fraction = tail - k
        return float((losses[:k].sum() + (fraction * losses[k] if k < len(losses) else 0)) / tail)

    def path_stats(r, years):
        wealth = np.r_[1.0, np.cumprod(1 + np.asarray(r))]
        drawdown = wealth / np.maximum.accumulate(wealth) - 1
        return wealth[-1]**(1 / years) - 1, float(drawdown.min())

    asset_rows = []
    for i, ticker in enumerate(tickers):
        r = R[:, i]
        vol = r.std(ddof=1) * np.sqrt(ANN)
        downside = np.sqrt(np.mean(np.minimum(r, 0)**2) * ANN)
        cagr, mdd = path_stats(r, fit_years)
        asset_rows.append({'ticker': ticker, 'forecast monthly %': 100*mu_month[i],
            'vol annual %': 100*vol, 'beta vs SPY': beta[i],
            'VaR95 session %': 100*np.quantile(-r, ALPHA), 'CVaR95 session %': 100*cvar_loss(r),
            'downside annual %': 100*downside, 'Sharpe': (r.mean()-rf_session)*ANN/vol,
            'alpha annual %': 100*ANN*(r.mean()-rf_session-beta[i]*(benchmark.mean()-rf_session)),
            'CAGR %': 100*cagr, 'max drawdown %': 100*mdd})
    indicators = pd.DataFrame(asset_rows).set_index('ticker')

    masks = {
        'equity': universe.asset_class.isin(['equity','etf_equity']).to_numpy(float),
        'bond': universe.asset_class.eq('etf_bond').to_numpy(float),
        'crypto': crypto.to_numpy(float),
        'gold': universe.asset_class.eq('etf_commodity').to_numpy(float),
        'usd': usd.to_numpy(float),
        'canada': universe.market.eq('TSX').to_numpy(float),
        'direct_tech': universe.sector.eq('Information Technology').to_numpy(float),
        'etf': universe.asset_class.str.startswith('etf_').to_numpy(float),
    }

    previous_w = np.repeat(0.90 / n, n)
    if 'previous_weights' in request:
        unknown = set(request['previous_weights']) - set(tickers)
        if unknown:
            raise InputError(f'Unknown previous holding tickers: {sorted(unknown)}')
        previous_w = np.array([request['previous_weights'].get(t, 0.0) for t in tickers])
    # Hypothetical joint CAD shock, not a historical event or currency model.
    stress = np.select([masks['equity'] == 1, masks['bond'] == 1,
                        masks['crypto'] == 1, masks['gold'] == 1],
                       [-.30, -.05, -.55, .05], default=0.0)

    def solve_portfolio(limits, mean_returns=mu_month):
        w = cp.Variable(n, nonneg=True)
        cash = cp.Variable(nonneg=True)
        rp = R @ w + rf_session * cash
        gross_trade = cp.norm1(w - previous_w)
        constraints = [cp.sum(w) + cash == 1]
        if 'position_max' in limits:
            constraints += [w <= limits['position_max']]
        if 'cash_min' in limits:
            constraints += [cash >= limits['cash_min']]
        for key, sense, vector in [('crypto_max','max',masks['crypto']),
                                   ('equity_max','max',masks['equity']),
                                   ('bond_min','min',masks['bond']),
                                   ('usd_max','max',masks['usd']),
                                   ('canada_min','min',masks['canada']),
                                   ('gold_min','min',masks['gold']),
                                   ('beta_max','max',beta)]:
            if key in limits:
                constraints += [vector @ w <= limits[key]] if sense == 'max' else [vector @ w >= limits[key]]
        if 'hhi_max' in limits:
            constraints += [cp.sum_squares(w) <= limits['hhi_max']]
        if 'vol_max' in limits:
            constraints += [cp.norm(centered @ w, 2)*np.sqrt(ANN/(len(R)-1)) <= limits['vol_max']]
        if 'te_max' in limits:
            active = rp - benchmark
            constraints += [cp.norm(active-cp.sum(active)/len(R), 2)*np.sqrt(ANN/(len(R)-1)) <= limits['te_max']]
        if 'downside_max' in limits:
            constraints += [cp.norm(cp.pos(-rp), 2)*np.sqrt(ANN/len(R)) <= limits['downside_max']]
        if 'cvar_max' in limits:
            threshold = cp.Variable()
            constraints += [threshold + cp.sum(cp.pos(-rp-threshold))/((1-ALPHA)*len(R)) <= limits['cvar_max']]
        if 'stress_max' in limits:
            constraints += [-stress @ w <= limits['stress_max']]   # Cash shock = 0
        if 'turnover_max' in limits:
            constraints += [gross_trade <= limits['turnover_max']]
        problem = cp.Problem(cp.Maximize(mean_returns @ w + rf_month*cash - KAPPA*gross_trade), constraints)
        assert problem.is_dcp()
        problem.solve(solver='CLARABEL', tol_gap_abs=1e-9, tol_feas=1e-9, tol_gap_rel=1e-9)
        if problem.status != 'optimal':
            return {'status': problem.status}
        return {'status': problem.status, 'w': w.value, 'cash': float(cash.value),
                'objective': float(problem.value)}

    def measures(w, cash):
        rp = R @ w + rf_session*cash
        active = rp - benchmark
        hhi = w @ w
        turnover = np.abs(w - previous_w).sum()
        return dict(position_max=w.max(), cash_min=cash,
            equity_max=masks['equity']@w, bond_min=masks['bond']@w, crypto_max=masks['crypto']@w,
            usd_max=masks['usd']@w, canada_min=masks['canada']@w, gold_min=masks['gold']@w,
            beta_max=beta@w, hhi_max=hhi,
            vol_max=rp.std(ddof=1)*np.sqrt(ANN), te_max=active.std(ddof=1)*np.sqrt(ANN),
            downside_max=np.sqrt(np.mean(np.minimum(rp,0)**2)*ANN), cvar_max=cvar_loss(rp),
            stress_max=-stress@w, turnover_max=turnover)


    provenance = {
        "base_currency":"CAD", "benchmark":"SPY in CAD", "train_start":str(train.index[0].date()),
        "fit_date":str(fit_end.date()), "training_returns":len(train), "sessions_per_year":ANN,
        "snapshot_end":str(cad_prices.index.max().date()),
        "as_of_policy":"Explicit as_of, or snapshot end minus one year (matches demo.ipynb).",
        "sources":sources[["file","source","retrieved_on"]].to_dict(orient="records"),
        "files": {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(DATA.glob('*.csv'))},
    }
    assumptions = {"kappa":KAPPA, "mean_shrinkage":SHRINK, "cash_annual_yield_proxy":rf_annual,
        "previous_weights":dict(zip(tickers,previous_w.tolist())), "previous_cash":float(1-previous_w.sum()),
        "stress_cad_returns":dict(zip(tickers,stress.tolist())), "stress_cash_return":0,
        "objective":"monthly expected return minus one-off gross asset trading cost",
        "budget":"asset weights + cash = 1; costs penalized outside normalized allocation budget",
        "risk_frequency":"volatility/downside/tracking error annualized; CVaR one common session",
        "units":"All output returns, weights and limits are fractions unless key ends in %."}
    if request['operation'] == 'indicators':
        trailing = actions.loc[actions.action.eq('dividend') & actions.ex_date.le(fit_end)
                               & actions.ex_date.gt(fit_end-pd.Timedelta(days=365))]
        closes = prices.loc[prices.date.le(fit_end)].sort_values('date').groupby('ticker').close.last()
        dividend = trailing.groupby('ticker').value.sum().reindex(tickers)/closes.reindex(tickers)
        indicators['observed dividend proxy %'] = 100*dividend
        records = json.loads(indicators.reset_index().to_json(orient='records'))
        return {"status":"ok", "provenance":provenance, "assumptions":assumptions,
                "indicators":records, "warnings":WARNINGS+['Missing dividend events are null, not verified zero yield.']}

    limits = {**PROFILES[request['profile']], **request['constraints']}
    solution = solve_portfolio(limits)
    result = {"status":solution['status'], "profile":request['profile'], "constraints":limits,
              "constraint_overrides":request['constraints'], "provenance":provenance,
              "assumptions":assumptions, "warnings":WARNINGS}
    if solution['status'] != 'optimal':
        if solution['status'] == 'infeasible':
            result['message'] = 'No feasible portfolio under these limits. No limit was relaxed. Revise explicit assumptions before retrying.'
            return result
        raise RuntimeError('Optimization did not produce a verified optimum: '+solution['status'])
    w,cash = solution['w'],solution['cash']
    values = measures(w,cash)
    checks = []
    if abs(w.sum()+cash-1)>TOL or min(w.min(),cash)<-TOL:
        raise RuntimeError('Portfolio failed budget or nonnegativity verification.')
    for key,limit in limits.items():
        actual = float(values[key])
        slack = actual-limit if key.endswith('_min') else limit-actual
        if slack < -TOL:
            raise RuntimeError('Portfolio failed independent constraint verification: '+key)
        checks.append(dict(constraint=key,actual=actual,limit=limit,slack=slack,binding=abs(slack)<1e-5))
    expected = float(mu_month@w+rf_month*cash)
    cost = float(KAPPA*np.abs(w-previous_w).sum())
    if abs(expected-cost-solution['objective'])>TOL:
        raise RuntimeError('Objective failed independent verification.')
    rp = R@w+rf_session*cash
    threshold = np.quantile(-rp,ALPHA,method='inverted_cdf')
    if abs(cvar_loss(rp)-(threshold+np.maximum(-rp-threshold,0).mean()/(1-ALPHA)))>TOL:
        raise RuntimeError('CVaR failed independent verification.')
    if abs(values['vol_max']**2-w@cov_annual@w)>TOL:
        raise RuntimeError('Volatility failed independent verification.')
    result.update(weights={**dict(zip(tickers,w.tolist())),"CASH":cash},
        metrics={"expected_monthly_return":expected,"one_off_cost":cost,"net_monthly_objective":expected-cost,
                 "annual_volatility":float(values['vol_max']),"annual_downside_deviation":float(values['downside_max']),
                 "session_var95":float(np.quantile(-rp,ALPHA)),"session_cvar95":float(values['cvar_max']),
                 "beta":float(values['beta_max']),"annual_tracking_error":float(values['te_max']),
                 "stress_loss":float(values['stress_max']),"asset_hhi":float(w@w),
                 "hhi_including_cash":float(w@w+cash**2),
                 "conditional_asset_effective_n":float(w.sum()**2/(w@w)) if w@w>1e-12 else None,
                 "gross_asset_turnover":float(values['turnover_max'])},
        exposures={k:float(v@w) for k,v in masks.items()},constraint_checks=checks)
    return result


def parse_json(text):
    def reject_constant(value):
        raise InputError(f'Non-finite JSON constant {value} is not allowed.')
    def unique_keys(pairs):
        result = {}
        for key,value in pairs:
            if key in result:
                raise InputError(f'Duplicate JSON key: {key}')
            result[key]=value
        return result
    if not isinstance(text,str) or len(text)>16000:
        raise InputError('request_json must be a JSON string of at most 16000 characters.')
    try:
        return json.loads(text,parse_constant=reject_constant,object_pairs_hook=unique_keys)
    except json.JSONDecodeError as exc:
        raise InputError('Invalid request_json: '+exc.msg) from exc


def portfolio_analysis(request_json: str):
    """Calculate a portfolio and return a transport-independent result."""
    try:
        return run(parse_json(request_json))
    except InputError as exc:
        return {'status': 'invalid_input', 'message': str(exc)}
    except Exception:
        logging.exception('Portfolio calculation failed')
        return {'status': 'error', 'message': 'Portfolio calculation failed. Check runtime logs and packaged data/dependencies.'}


def lambda_handler(event, context):
    """Legacy Bedrock function-details contract, retained for existing callers."""
    state = None
    try:
        if event.get('messageVersion') != '1.0' or event.get('function') != 'portfolio_analysis':
            raise InputError('Expected messageVersion 1.0 and function portfolio_analysis.')
        parameters = event.get('parameters', [])
        if not isinstance(parameters, list) or len(parameters) != 1:
            raise InputError('Supply exactly one parameter: request_json (string).')
        parameter = parameters[0]
        if not isinstance(parameter, dict) or parameter.get('name') != 'request_json' or parameter.get('type') != 'string':
            raise InputError('Supply exactly one parameter: request_json (string).')
        payload = run(parse_json(parameter.get('value')))
        if payload['status'] == 'infeasible':
            state = 'REPROMPT'
    except InputError as exc:
        payload, state = {'status': 'invalid_input', 'message': str(exc)}, 'REPROMPT'
    except Exception:
        logging.exception('Portfolio calculation failed')
        payload, state = {'status': 'error', 'message': 'Portfolio calculation failed. Check Lambda logs and packaged data/dependencies.'}, 'FAILURE'
    response = {'responseBody': {'TEXT': {'body': json.dumps(payload, allow_nan=False, separators=(',', ':'))}}}
    if state:
        response['responseState'] = state
    return {'messageVersion': '1.0', 'response': {'actionGroup': event.get('actionGroup', 'AlphaForgePortfolio'),
            'function': event.get('function', 'portfolio_analysis'), 'functionResponse': response},
            'sessionAttributes': event.get('sessionAttributes', {}),
            'promptSessionAttributes': event.get('promptSessionAttributes', {})}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request',default='{"profile":"Balanced"}')
    args=parser.parse_args()
    try:
        print(json.dumps(run(parse_json(args.request)),indent=2,allow_nan=False))
    except InputError as exc:
        parser.error(str(exc))
