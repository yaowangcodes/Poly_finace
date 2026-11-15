"use client";
import { useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
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
const metrics = [
  ["expected_monthly_return", "Expected monthly return"],
  ["annual_volatility", "Annualized volatility"],
  ["session_cvar95", "95% one-session CVaR"],
  ["one_off_cost", "One-off trading cost"],
  ["net_monthly_objective", "Net monthly objective"],
];
const plainMetrics = new Set([
  "beta",
  "asset_hhi",
  "hhi_including_cash",
  "conditional_asset_effective_n",
]);
export function metricValue(key: string, value: number | null | undefined) {
  return value == null
    ? "Unavailable"
    : plainMetrics.has(key)
      ? value.toFixed(3)
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
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));
  const fit = result.provenance?.fit_date;
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
          aria-label="Portfolio allocation chart; exact weights are listed in the asset table"
        >
          {weights.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={weights}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={79}
                  paddingAngle={1.5}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {weights.map((v, i) => (
                    <Cell
                      key={v.name}
                      fill={
                        v.name === "CASH"
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
            <strong>{weights.length}</strong>
            <small>positions</small>
          </div>
        </div>
        <div className="allocation-legend">
          {weights.slice(0, 5).map((w, i) => (
            <div key={w.name}>
              <i
                style={{
                  background:
                    w.name === "CASH" ? "#d9b870" : colors[i % colors.length],
                }}
              />
              <span>{w.name}</span>
              <strong>{(w.value * 100).toFixed(2)}%</strong>
            </div>
          ))}
          {weights.length > 5 && (
            <small>+ {weights.length - 5} more in asset table</small>
          )}
        </div>
      </div>
      <div className="metric-grid">
        {metrics.map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <strong>{metricValue(key, result.metrics?.[key])}</strong>
          </div>
        ))}
      </div>
      <button
        className="details-button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide" : "View"} allocation & constraint details{" "}
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="portfolio-details">
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
                    <td>{w.name === "CASH" ? "Cash" : "Unavailable"}</td>
                    <td>Unavailable</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
