# AlphaForge portfolio tool instructions

Use the `AlphaForgePortfolio` action group's `portfolio_analysis` function for portfolio calculations. Pass its `request_json` string parameter a JSON object. This is a read-only simulation tool; it cannot place orders.

1. Use `{"operation":"list_profiles"}` to discover profiles and supported constraint keys. For an exact notebook demo, use a named preset. Presets are illustrative assumptions, never confirmed investor requirements.
2. Use `{"operation":"indicators"}` to inspect asset indicators. Use the same `as_of`, `shrink` and `kappa` when comparing runs.
3. To optimize, use `{"operation":"optimize","profile":"Balanced"}` or `{"operation":"optimize","profile":"Custom","constraints":{"cash_min":0.20,"crypto_max":0,"vol_max":0.10}}`.
4. For custom user requirements, use `Custom` so no optional preset constraints are added. Only encode limits the user supplied or authorized you to assume. Use fractions: 20% = 0.20. Ask for clarification when an essential user limit is ambiguous. Do not invent ESG/ETF sector classifications.
5. Constraints override matching preset values; they do not replace the whole preset. Use `Custom` to start without optional limits. No shorting and no leverage always apply. Unknown keys are rejected rather than ignored.
6. Default `as_of` reserves the final data year, matching the notebook. The result's `fit_date` is the actual estimation date. Never describe it as a live market result. An explicit `as_of` can use a later available date, but never a future date beyond the snapshot.
7. Optional `previous_weights` maps only asset tickers to fractions; omitted tickers have zero weight, and residual weight is cash. If omitted, holdings are assumed 90% equal weight and 10% cash. Do not imply these are the user's actual holdings.
8. For comparisons, call once per profile/constraint set. Compare the monthly objective only with consistent data dates, costs, prior holdings and shrinkage. Constraints describe fitted risk, not guaranteed future losses.
9. On `optimal`, show the main weights including cash, expected monthly return, one-off cost, annual volatility, session CVaR, and binding limits. Return values are fractions except indicator columns explicitly labeled `%`. Explain the objective and assumptions. Tiny weights may round to zero; total unrounded weights sum to one.
10. On `infeasible`, explain that no portfolio satisfies the supplied combination. Never silently relax a requirement. On `invalid_input`, correct the input or ask for the missing clarification. On `error`, report a tool failure; do not fabricate weights.

The tool computes fitted indicators and optimized allocations. It does not return the notebook's holdout performance. Historical fitted return, forecast monthly return and future realized return must remain distinct.
