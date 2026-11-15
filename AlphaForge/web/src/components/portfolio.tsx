"use client";
import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, LineChart, Line, XAxis, YAxis, ReferenceDot, Legend } from "recharts";
import { ArrowUpRight, ChartPie, ChevronDown, ChevronUp } from "lucide-react";
import { formatLimit, labels, type Portfolio } from "@/lib/types";
const colors = [
  "#226f60",
  "#56a18c",
  "#85b8a7",
  "#b4d3c4",
  "#d9b870",
  "#b192ba",
  "#899bb5",
  "#b9c6d6",
];
const metricSections = [
  { title: "Expected Performance", metrics: [
    ["expected_monthly_return", "Expected monthly return", ""],
    ["annual_volatility", "Annualized volatility", ""],
    ["net_monthly_objective", "Net monthly objective", ""],
    ["one_off_cost", "One-off trading cost", ""],
  ] },
  { title: "Historical Risk & Performance", metrics: [
    ["maximum_drawdown", "Maximum Drawdown", "Largest historical decline from a prior peak, including the starting value."],
    ["session_cvar95", "95% one-session CVaR", "Existing fitted empirical expected shortfall over one common session; not a monthly loss or reconstruction statistic."],
    ["positive_month_rate", "Positive Month Rate", "Share of complete interior calendar months with compounded portfolio returns above zero."],
    ["worst_monthly_return", "Worst Monthly Return", "Lowest compounded portfolio return among complete interior calendar months."],
  ] },
  { title: "Risk-Adjusted Return & Diversification", metrics: [
    ["sharpe_ratio", "Sharpe Ratio", "Annualized mean excess return divided by sample excess-return volatility, using lagged CAD risk-free rates."],
    ["sortino_ratio", "Sortino Ratio", "Annualized return above MAR divided by downside deviation over all sessions. MAR defaults to the lagged CAD risk-free return."],
    ["calmar_ratio", "Calmar Ratio", "Historical compound annualized return divided by the absolute maximum drawdown."],
    ["portfolio_beta", "Portfolio Beta", "Portfolio covariance with SPY divided by SPY variance, using the same CAD returns and dates."],
    ["top_five_concentration", "Top Five Holdings Concentration", "Combined weights of the five largest holdings, including cash. Short portfolios use absolute exposures."],
  ] },
];
const metrics = metricSections.flatMap((section) => section.metrics);
const plainMetrics = new Set([
  "beta",
  "portfolio_beta",
  "sharpe_ratio",
  "sortino_ratio",
  "calmar_ratio",
  "asset_hhi",
  "hhi_including_cash",
  "conditional_asset_effective_n",
]);
export function metricValue(key: string, value: number | null | undefined) {
  return value == null || !Number.isFinite(value)
    ? "N/A"
    : plainMetrics.has(key)
      ? value.toFixed(2)
      : `${(value * 100).toFixed(2)}%`;
}
export function PortfolioPanel({ result }: { result: Portfolio }) {
  const [expanded, setExpanded] = useState(false);
  if (result.status !== "optimal")
    return (
      <section className="portfolio-state" role="status">
        <strong>
          {result.status === "infeasible"
            ? "No feasible portfolio"
            : `Calculation: ${result.status}`}
        </strong>
        <p>
          {result.message ??
            "No verified allocation is available for this calculation."}
        </p>
      </section>
    );
  const weights = Object.entries(result.weights ?? {})
    // Hide zero positions and solver residuals that round to zero at table precision.
    .filter(([, value]) => Number.isFinite(value) && Number((value * 100).toFixed(3)) !== 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
  const fit = result.provenance?.fit_date;
  const analytics = result.historical_analytics;
  const allocation = Object.entries(weights.reduce<Record<string, number>>((groups, holding) => {
    const category = result.asset_classes?.[holding.name] ?? (holding.name === "CASH" ? "cash" : "Unclassified");
    groups[category] = (groups[category] ?? 0) + holding.value;
    return groups;
  }, {})).map(([name, value]) => ({ name: name.replaceAll("_", " "), value }));
  return (
    <section className="portfolio-panel" aria-label="Portfolio results">
      <header>
        <div className="panel-icon">
          <ChartPie size={19} />
        </div>
        <div>
          <h3>Portfolio analysis</h3>
          <p>
            {result.profile ?? "Portfolio"} · Snapshot simulation
            {typeof fit === "string" ? ` · ${fit}` : ""}
          </p>
        </div>
        <span className="status-pill">Optimal</span>
      </header>
      <div className="allocation">
        <div
          className="donut"
          role="img"
          aria-label="Portfolio allocation by asset class; exact holding weights are listed in the asset table"
        >
          {weights.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={allocation}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={79}
                  paddingAngle={1.5}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {allocation.map((v, i) => (
                    <Cell
                      key={v.name}
                      fill={
                        v.name === "cash"
                          ? "#d9b870"
                          : colors[i % colors.length]
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => `${(Number(v) * 100).toFixed(2)}%`}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <p>Allocation unavailable</p>
          )}
          <div className="donut-center">
            <span>ALLOCATION</span>
            <strong>{allocation.length}</strong>
            <small>asset classes</small>
          </div>
        </div>
        <div className="allocation-legend">
          {allocation.map((w, i) => (
            <div key={w.name}>
              <i
                style={{
                  background:
                    w.name === "cash" ? "#d9b870" : colors[i % colors.length],
                }}
              />
              <span>{w.name}</span>
              <strong>{(w.value * 100).toFixed(2)}%</strong>
            </div>
          ))}
          <small>{weights.length} holdings in asset table</small>
        </div>
      </div>
      <section className="portfolio-details allocation-details" aria-label="Asset allocation">
          <h4>Asset allocation</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Weight</th>
                  <th>Category</th>
                  <th>Asset risk / return</th>
                </tr>
              </thead>
              <tbody>
                {weights.map((w) => (
                  <tr key={w.name}>
                    <td>{w.name}</td>
                    <td>{(w.value * 100).toFixed(3)}%</td>
                    <td>{result.asset_classes?.[w.name]?.replaceAll("_", " ") ?? (w.name === "CASH" ? "Cash" : "Unavailable")}</td>
                    <td>Unavailable</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </section>
      {metricSections.map((section) => (
        <section className="metric-section" key={section.title} aria-label={section.title}>
          <h4>{section.title}</h4>
          <div className="metric-grid">
            {section.metrics.map(([key, label, help]) => {
              const missing = result.metrics?.[key] == null;
              const reason = analytics?.unavailable_reasons[key] ?? "This result does not include this metric. Optimize again with the updated backend.";
              return <div key={key}>
                <span>{key === "top_five_concentration" ? analytics?.concentration_label ?? label : label}
                  {help && <span className="metric-help" tabIndex={0} role="note" aria-label={help} title={help}>ⓘ</span>}
                </span>
                <strong title={missing ? reason : undefined}>{metricValue(key, result.metrics?.[key])}</strong>
                {missing && <small className="metric-unavailable">{reason}</small>}
              </div>;
            })}
          </div>
        </section>
      ))}
      {analytics && <div className="historical-context">
        <strong>{analytics.label}</strong>
        <p>{analytics.start_date} – {analytics.end_date ?? "N/A"} · CAD · {analytics.observations} sessions · {analytics.valid_months} complete months</p>
        <details><summary>Calculation assumptions</summary><p>{analytics.methodology}</p></details>
      </div>}
      {!!analytics?.history.length && <div className="history-charts">
        <h4>Portfolio vs Benchmark Performance</h4>
        <p className="small-note">Growth of CAD 1 · month-end samples plus the maximum drawdown date</p>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={analytics.history} margin={{ right: 20, left: 0 }}>
            <XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 10 }} />
            <YAxis width={45} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value) => value == null ? "N/A" : Number(value).toFixed(2)} />
            <Legend />
            <Line name="Portfolio (CAD)" dataKey="portfolio" stroke="#56a18c" dot={false} isAnimationActive={false} />
            <Line name="SPY (CAD)" dataKey="benchmark" stroke="#d9b870" dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <h4>Historical Drawdown</h4>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={analytics.history} margin={{ right: 20, left: 0 }}>
            <XAxis dataKey="date" minTickGap={50} tick={{ fontSize: 10 }} />
            <YAxis width={55} tick={{ fontSize: 10 }} tickFormatter={(value: number) => `${(value * 100).toFixed(0)}%`} />
            <Tooltip formatter={(value) => `${(Number(value) * 100).toFixed(2)}%`} />
            <Line name="Drawdown" dataKey="drawdown" stroke="#b192ba" dot={false} isAnimationActive={false} />
            <ReferenceDot x={analytics.maximum_drawdown_date} y={result.metrics?.maximum_drawdown ?? 0} r={5} fill="#d9b870" stroke="none" />
          </LineChart>
        </ResponsiveContainer>
        <p className="small-note">Maximum drawdown: {metricValue("maximum_drawdown", result.metrics?.maximum_drawdown)} on {analytics.maximum_drawdown_date}</p>
      </div>}
      <button
        className="details-button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View"} constraint details{" "}
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="portfolio-details">
          <h4>Engine constraint checks</h4>
          {result.constraint_checks?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Constraint</th>
                    <th>Limit</th>
                    <th>Actual</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.constraint_checks.map((c) => (
                    <tr key={c.constraint}>
                      <td>{labels[c.constraint] ?? c.constraint}</td>
                      <td>{formatLimit(c.constraint, c.limit)}</td>
                      <td>{formatLimit(c.constraint, c.actual)}</td>
                      <td>
                        <span
                          className={
                            c.slack < -2e-6 ? "negative" : "check-state"
                          }
                        >
                          {c.slack < -2e-6
                            ? "Violated"
                            : c.binding
                              ? "Binding"
                              : "Nonbinding"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Constraint checks unavailable.</p>
          )}
          <h4>Additional engine metrics</h4>
          <dl className="extra-metrics">
            {Object.entries(result.metrics ?? {})
              .filter(([key]) => !metrics.some(([k]) => k === key))
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k.replaceAll("_", " ")}</dt>
                  <dd>{metricValue(k, v)}</dd>
                </div>
              ))}
          </dl>
          {result.warnings?.map((w) => (
            <p className="small-note" key={w}>
              {w}
            </p>
          ))}
          <p className="small-note">
            <ArrowUpRight size={12} /> Historical fitted estimates are not
            guarantees of future returns.
          </p>
        </div>
      )}
    </section>
  );
}
