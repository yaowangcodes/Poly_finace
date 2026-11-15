# Portfolio historical analytics

`portfolio_analytics.py` adds post-solve analytics. The optimizer, constraints, personas, existing metrics, and indicator operation are unchanged. `portfolio_skill.py` passes the complete optimized allocation, including cash, and the same training window ending at `fit_date`. These are **Hypothetical Historical Reconstruction** results, not an out-of-sample backtest.

- Adjusted prices and USD/CAD FX reuse the existing common calendar and CAD conversion. Crypto uses prior UTC closes. Missing price/FX dates are removed before returns are calculated; a common session can span multiple calendar days. Existing snapshot/survivorship limitations still apply.
- Historical cash and risk-free returns compound the Canadian V39079 effective annual yield proxy, divided by 100, over calendar days using rates available strictly before each accrual day. No future rate is backfilled. These historical cash returns intentionally differ from the optimizer's unchanged constant fit-date cash proxy.
- Fixed optimized weights are rebalanced each common session. Historical results exclude transaction costs, fees and taxes. The weights themselves are fitted on the evaluation window, so the reconstruction has in-sample selection bias.
- MDD includes the initial wealth of 1. Sharpe uses sample standard deviation (`ddof=1`) of excess returns. Sortino uses the root mean square of negative deviations over **all** observations. MAR defaults to dated risk-free returns; callers of the analytics function may supply an aligned per-session MAR series.
- Annualization uses the number of common returns divided by elapsed years (365.25 days/year). Calmar uses compounded annualized historical return / absolute MDD.
- Monthly returns compound common-session portfolio returns. Both boundary months are conservatively excluded, including when a boundary happens to be month-end. The response states the number of valid interior months. A session crossing a month boundary belongs to its ending date.
- Beta is sample portfolio/SPY covariance divided by sample SPY variance on identical CAD dates. Top-five concentration includes cash; short allocations use absolute exposures and the gross-exposure label. The current optimizer is long-only.
- Undefined metrics return JSON `null` plus a reason: fewer than two observations, missing holding returns, missing risk-free/MAR or benchmark returns, zero excess-return volatility, zero downside deviation, zero drawdown, zero benchmark variance, or no interior months. Missing holdings invalidate historical metrics rather than silently changing the window.

The existing `metrics` dictionary gains eight fields. `historical_analytics` supplies provenance, unavailable reasons and compact chart observations (month-end samples, the starting point, and exact MDD date). `asset_classes` supplies allocation categories. The web schema validates these optional fields, preserving compatibility with saved results. `PortfolioPanel` reads them automatically for each newly returned optimization and shows N/A explanations for older results.

Recharts is reused for growth, sampled drawdown with the MDD point, and the asset-class donut. The original exact holding table and constraint checks remain available. Growth charts use CAD 1 as their initial value.

The Dockerfile includes the new module. The backend must be redeployed for a locally running frontend connected to AgentCore to receive the new fields; historical saved conversations are not recalculated.

Validation commands:

```sh
.venv/bin/python -m unittest discover -s bedrock_portfolio -p 'test_portfolio*.py'
# From web, using the project's Node installation:
npm run typecheck
npm run lint
npm test
npm run build
```
