"""Build the AlphaForge AI starter dataset.

Usage:
    python -m venv .venv && .venv/bin/pip install pandas yfinance
    .venv/bin/python build_dataset.py

Edit UNIVERSE, START, END below and re-run. Everything is regenerated into OUT_DIR.
"""

import io
import json
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

OUT_DIR = Path(__file__).parent
START = "2021-11-12"
END = "2026-11-12"  # last complete trading day, inclusive
RETRIEVED = date.today().isoformat()

# ticker, name, asset_class, market, currency, sector
UNIVERSE = [
    # Canadian equities (10)
    ("RY.TO", "Royal Bank of Canada", "equity", "TSX", "CAD", "Financials"),
    ("TD.TO", "Toronto-Dominion Bank", "equity", "TSX", "CAD", "Financials"),
    ("MFC.TO", "Manulife Financial", "equity", "TSX", "CAD", "Financials"),
    ("ENB.TO", "Enbridge", "equity", "TSX", "CAD", "Energy"),
    ("CNQ.TO", "Canadian Natural Resources", "equity", "TSX", "CAD", "Energy"),
    ("CNR.TO", "Canadian National Railway", "equity", "TSX", "CAD", "Industrials"),
    ("FTS.TO", "Fortis", "equity", "TSX", "CAD", "Utilities"),
    ("ATD.TO", "Alimentation Couche-Tard", "equity", "TSX", "CAD", "Consumer Staples"),
    ("SHOP.TO", "Shopify", "equity", "TSX", "CAD", "Information Technology"),
    ("CSU.TO", "Constellation Software", "equity", "TSX", "CAD", "Information Technology"),
    # U.S. equities (10)
    ("AAPL", "Apple", "equity", "NASDAQ", "USD", "Information Technology"),
    ("MSFT", "Microsoft", "equity", "NASDAQ", "USD", "Information Technology"),
    ("NVDA", "NVIDIA", "equity", "NASDAQ", "USD", "Information Technology"),
    ("GOOGL", "Alphabet (Class A)", "equity", "NASDAQ", "USD", "Communication Services"),
    ("AMZN", "Amazon", "equity", "NASDAQ", "USD", "Consumer Discretionary"),
    ("TSLA", "Tesla", "equity", "NASDAQ", "USD", "Consumer Discretionary"),
    ("JPM", "JPMorgan Chase", "equity", "NYSE", "USD", "Financials"),
    ("JNJ", "Johnson & Johnson", "equity", "NYSE", "USD", "Health Care"),
    ("PG", "Procter & Gamble", "equity", "NYSE", "USD", "Consumer Staples"),
    ("XOM", "Exxon Mobil", "equity", "NYSE", "USD", "Energy"),
    # ETFs (9)
    ("XIU.TO", "iShares S&P/TSX 60 Index ETF", "etf_equity", "TSX", "CAD", "Broad market (Canada)"),
    ("SPY", "SPDR S&P 500 ETF Trust", "etf_equity", "NYSE Arca", "USD", "Broad market (U.S.)"),
    ("QQQ", "Invesco QQQ Trust (Nasdaq-100)", "etf_equity", "NASDAQ", "USD", "Broad market (U.S. growth/tech-heavy)"),
    ("ESGV", "Vanguard ESG U.S. Stock ETF", "etf_equity", "Cboe BZX", "USD", "Broad market (U.S., ESG-screened)"),
    ("XBB.TO", "iShares Core Canadian Universe Bond Index ETF", "etf_bond", "TSX", "CAD", "Bonds (Canada aggregate)"),
    ("ZST.TO", "BMO Ultra Short-Term Bond ETF", "etf_bond", "TSX", "CAD", "Bonds (Canada ultra short-term)"),
    ("AGG", "iShares Core U.S. Aggregate Bond ETF", "etf_bond", "NYSE Arca", "USD", "Bonds (U.S. aggregate)"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "etf_bond", "NASDAQ", "USD", "Bonds (U.S. long Treasury)"),
    ("GLD", "SPDR Gold Shares", "etf_commodity", "NYSE Arca", "USD", "Gold"),
    # Crypto (2)
    ("BTC-USD", "Bitcoin", "crypto", "Crypto (24/7)", "USD", "Crypto asset"),
    ("ETH-USD", "Ether", "crypto", "Crypto (24/7)", "USD", "Crypto asset"),
]

BOC_SERIES = {
    "FXUSDCAD": ("USD/CAD daily exchange rate (CAD per 1 USD)", "CAD per USD", "daily"),
    "V39079": ("Bank of Canada target for the overnight rate", "percent", "daily (changes on announcement dates)"),
    "BD.CDN.2YR.DQ.YLD": ("Government of Canada benchmark bond yield, 2-year", "percent", "business daily"),
    "BD.CDN.10YR.DQ.YLD": ("Government of Canada benchmark bond yield, 10-year", "percent", "business daily"),
    "STATIC_TOTALCPICHANGE": ("Canada total CPI, % change y/y (unadjusted)", "percent", "monthly"),
}
FRED_SERIES = {
    "DFF": ("U.S. effective federal funds rate", "percent", "daily"),
    "DGS2": ("U.S. Treasury constant maturity yield, 2-year", "percent", "business daily"),
    "DGS10": ("U.S. Treasury constant maturity yield, 10-year", "percent", "business daily"),
    "CPIAUCSL": ("U.S. CPI, all urban consumers (index 1982-84=100, SA)", "index", "monthly"),
    "UNRATE": ("U.S. unemployment rate (SA)", "percent", "monthly"),
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def build_universe() -> pd.DataFrame:
    df = pd.DataFrame(UNIVERSE, columns=["ticker", "name", "asset_class", "market", "currency", "sector"])
    df.insert(0, "asset_id", [f"A{i:02d}" for i in range(1, len(df) + 1)])
    return df


def build_prices(universe: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    tickers = universe["ticker"].tolist()
    end_excl = (date.fromisoformat(END) + timedelta(days=1)).isoformat()
    raw = yf.download(
        tickers, start=START, end=end_excl, auto_adjust=False, actions=True,
        group_by="ticker", progress=False, threads=True,
    )
    ccy = dict(zip(universe["ticker"], universe["currency"]))
    price_rows, action_rows = [], []
    for t in tickers:
        d = raw[t].dropna(subset=["Close"]).reset_index()
        d["Date"] = pd.to_datetime(d["Date"]).dt.date
        p = pd.DataFrame({
            "date": d["Date"], "ticker": t,
            "open": d["Open"], "high": d["High"], "low": d["Low"],
            "close": d["Close"], "adj_close": d["Adj Close"],
            "volume": d["Volume"].astype("int64"), "currency": ccy[t],
        })
        price_rows.append(p)
        for col, kind in (("Dividends", "dividend"), ("Stock Splits", "split")):
            if col in d:
                a = d.loc[d[col] > 0, ["Date", col]]
                for _, r in a.iterrows():
                    action_rows.append({
                        "ex_date": r["Date"], "ticker": t, "action": kind, "value": r[col],
                        "unit": f"{ccy[t]} per share" if kind == "dividend" else "split ratio (new:old)",
                    })
    prices = pd.concat(price_rows, ignore_index=True)
    for c in ("open", "high", "low", "close", "adj_close"):
        prices[c] = prices[c].round(6)
    actions = pd.DataFrame(action_rows, columns=["ex_date", "ticker", "action", "value", "unit"])
    return prices, actions.sort_values(["ticker", "ex_date"]).reset_index(drop=True)


def boc(series_id: str) -> pd.DataFrame:
    data = json.loads(get(f"https://www.bankofcanada.ca/valet/observations/{series_id}/json?start_date={START}&end_date={END}"))
    rows = [(o["d"], o[series_id]["v"]) for o in data["observations"] if series_id in o and o[series_id].get("v") not in (None, "")]
    return pd.DataFrame(rows, columns=["date", "value"]).astype({"value": float})


def fred(series_id: str) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={START}&coed={END}")))
    df.columns = ["date", "value"]
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.dropna()


def build_macro() -> tuple[pd.DataFrame, pd.DataFrame]:
    fx = boc("FXUSDCAD").rename(columns={"value": "usdcad"})
    fx["cadusd"] = (1 / fx["usdcad"]).round(6)
    frames = []
    for sid, (label, unit, freq) in BOC_SERIES.items():
        if sid == "FXUSDCAD":
            continue
        d = boc(sid)
        d["series_id"], d["label"], d["unit"], d["frequency"], d["source"] = sid, label, unit, freq, "Bank of Canada Valet API"
        frames.append(d)
    for sid, (label, unit, freq) in FRED_SERIES.items():
        d = fred(sid)
        d["series_id"], d["label"], d["unit"], d["frequency"], d["source"] = sid, label, unit, freq, "FRED, Federal Reserve Bank of St. Louis"
        frames.append(d)
    macro = pd.concat(frames, ignore_index=True)[["date", "series_id", "value", "unit", "frequency", "label", "source"]]
    return fx, macro.sort_values(["series_id", "date"]).reset_index(drop=True)


def check(universe, prices, actions, fx, macro) -> list[str]:
    """Hard asserts plus a list of warnings for the README."""
    warnings = []
    assert not prices.duplicated(["date", "ticker"]).any(), "duplicate (date, ticker) rows"
    assert set(prices["ticker"]) == set(universe["ticker"]), (
        f"ticker mismatch: missing={set(universe['ticker']) - set(prices['ticker'])}")
    merged = prices[["ticker", "currency"]].drop_duplicates().merge(universe[["ticker", "currency"]], on="ticker")
    assert (merged["currency_x"] == merged["currency_y"]).all(), "currency mismatch"
    assert prices["adj_close"].notna().all() and (prices["adj_close"] > 0).all(), "bad adj_close"
    assert not fx.duplicated("date").any(), "duplicate fx dates"

    print(f"\n{'ticker':10} {'rows':>5}  first       last")
    for t, g in prices.groupby("ticker"):
        print(f"{t:10} {len(g):5}  {g['date'].min()}  {g['date'].max()}")
        if str(g["date"].min()) > START[:8] + "20":
            warnings.append(f"{t}: history starts {g['date'].min()}, later than {START}")
        if str(g["date"].max()) < END:
            warnings.append(f"{t}: last observation {g['date'].max()}, before {END}")
        r = g.sort_values("date")["adj_close"].pct_change().abs()
        for i in r[r > 0.40].index:
            warnings.append(f"{t}: one-day adjusted move of {r[i]:.0%} on {g.loc[i, 'date']} (check for split/data error)")
        # gaps: >5 calendar days between equity obs, >1 for crypto
        gap_days = 1 if t.endswith("-USD") else 5
        dd = pd.to_datetime(g.sort_values("date")["date"]).diff().dt.days
        for i in dd[dd > gap_days].index:
            warnings.append(f"{t}: {int(dd[i])}-day gap before {g.loc[i, 'date']}")
    print(f"\nprices: {len(prices)} rows; actions: {len(actions)}; fx: {len(fx)}; macro: {len(macro)}")
    for sid, g in macro.groupby("series_id"):
        print(f"  {sid:22} {len(g):5}  {g['date'].min()} .. {g['date'].max()}")
    return warnings


def main():
    OUT_DIR.mkdir(exist_ok=True)
    universe = build_universe()
    prices, actions = build_prices(universe)
    fx, macro = build_macro()
    warnings = check(universe, prices, actions, fx, macro)

    universe.to_csv(OUT_DIR / "assets_universe.csv", index=False)
    prices.sort_values(["ticker", "date"]).to_csv(OUT_DIR / "prices_daily.csv", index=False)
    actions.to_csv(OUT_DIR / "corporate_actions.csv", index=False)
    fx.to_csv(OUT_DIR / "fx_usdcad_daily.csv", index=False)
    macro.to_csv(OUT_DIR / "macro_rates.csv", index=False)
    (OUT_DIR / "data_quality_warnings.txt").write_text(
        f"Generated {RETRIEVED}. Window {START} to {END}.\n" + ("\n".join(warnings) or "No warnings.") + "\n")
    print(f"\n{len(warnings)} warnings written to data_quality_warnings.txt")
    for w in warnings[:40]:
        print("  ", w)


if __name__ == "__main__":
    sys.exit(main())
