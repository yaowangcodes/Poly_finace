# AlphaForge AI starter dataset

*Version française plus bas.*

Optional starting data for the PolyFinances AlphaForge AI datathon. You can use it as is, add to it, or ignore it. Everything here is simulation material. Nothing in it is investment advice.

Window: **2021-11-12 to 2026-11-12** (5 years, retrieved 2026-11-13). Five years instead of three so the 2022 drawdown, when stocks and bonds fell together, is in the sample.

## A starting point, not the answer

This pack exists so you don't lose your first hours hunting for prices. It is not the dataset the jury expects you to use, and it doesn't cover everything a good project needs. Swap assets, pick a different period, or bring in news, company filings, ESG information, ETF holdings or any other public data that fits the problem you choose. The personas and example tickers in the brief are reference points, not a checklist.

The best projects usually start from a question, work out what data it needs, and then go get that data. Whatever you add, document its source, date and processing, as the brief asks.

## Files

| File | Rows | What it holds |
| --- | --- | --- |
| `assets_universe.csv` | 31 | `asset_id, ticker, name, asset_class, market, currency, sector` |
| `prices_daily.csv` | ~40,000 | `date, ticker, open, high, low, close, adj_close, volume, currency` |
| `corporate_actions.csv` | ~660 | Dividends and splits by ex-date |
| `fx_usdcad_daily.csv` | ~1,250 | `date, usdcad, cadusd` from the Bank of Canada |
| `macro_rates.csv` | ~8,300 | Long format `date, series_id, value, unit, frequency, label, source` |
| `sources_metadata.csv` | 6 | Source, date, processing, limitations and terms for each file |
| `build_dataset.py` | | Script that regenerates the five CSV data files and `data_quality_warnings.txt` |

### Universe

- **Canadian equities (10):** RY, TD, MFC, ENB, CNQ, CNR, FTS, ATD, SHOP, CSU (all `.TO`)
- **U.S. equities (10):** AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA, JPM, JNJ, PG, XOM
- **ETFs (9):** XIU.TO, SPY, QQQ, ESGV (ESG-screened U.S. equity), XBB.TO, ZST.TO (ultra short-term bonds), AGG, TLT, GLD
- **Crypto (2):** BTC-USD, ETH-USD

For the personas in the brief: energy names (ENB, CNQ, XOM) are included so Mateo's screening has real candidates to examine, and ESGV lets teams compare a screened fund with SPY. The data does not say whether any company is involved in significant environmental or social controversies. Teams need outside evidence for that. TSLA and NVDA are high-profile, volatile names for Robert's test. Amira gets crypto plus non-tech growth.

### Macro series (`macro_rates.csv`)

| series_id | Description | Source |
| --- | --- | --- |
| `V39079` | Bank of Canada target overnight rate | Bank of Canada |
| `BD.CDN.2YR.DQ.YLD`, `BD.CDN.10YR.DQ.YLD` | Government of Canada 2y and 10y yields | Bank of Canada |
| `STATIC_TOTALCPICHANGE` | Canada CPI, % y/y | Bank of Canada |
| `DFF` | U.S. effective federal funds rate | FRED |
| `DGS2`, `DGS10` | U.S. Treasury 2y and 10y yields | FRED |
| `CPIAUCSL` | U.S. CPI index | FRED |
| `UNRATE` | U.S. unemployment rate | FRED |

## Things to know before using the data

- **Prices are in each asset's listing currency.** `.TO` tickers are CAD; everything else is USD. Use `fx_usdcad_daily.csv` to convert. The FX file has no rows on Canadian holidays, so carry the last rate forward if you need one.
- **No forward-fill, no calendar alignment.** A row exists only on days Yahoo reports a price for the asset (ZST.TO has one zero-volume row, on 2022-07-06). TSX and U.S. holidays differ, and crypto trades 7 days a week (1,827 rows versus 1,255 for equities). Align calendars yourself, and say how you did it.
- **`adj_close` is adjusted for splits and dividends** (Yahoo's method, back-adjusted from the latest date). Use it for returns. `close` is adjusted for splits only. If you re-download later, `adj_close` values for older dates will change.
- **All prices are already split-adjusted.** The split rows in `corporate_actions.csv` are for reference. Don't apply them to `close` again.
- **Crypto rows are UTC calendar days.** The row dated D covers 00:00 to 24:00 UTC on D. There is no market close.
- **CNQ.TO shows a 1.021 "split" on 2022-08-22**, the same day as a 0.75 CAD dividend. CNQ has not done a 1.021 share split, so this factor likely reflects a special distribution. Check CNQ's investor relations page before relying on it.
- **Monthly macro data is dated to the reference month, not the release date.** U.S. and Canadian CPI for a given month come out weeks later. Do not use a value in a backtest before it was published. FRED values are the latest revised figures, not as first published.
- **Survivorship bias.** The universe was picked in 2026 from names that are large today. A backtest on it will look better than a strategy picked in 2021 would have.
- **No ESG scores, news or fundamentals are included.** We didn't want to ship ESG ratings we couldn't source and license properly. Teams who need them can use company sustainability reports, ETF issuers' ESG methodology pages, SEDAR+ and SEC EDGAR filings, and must document what they used.
- `data_quality_warnings.txt` lists gaps and suspicious one-day moves found at build time. The current build found none.

## Rebuild

```bash
python -m venv .venv
.venv/bin/pip install pandas yfinance
.venv/bin/python build_dataset.py
```

Edit `UNIVERSE`, `START` and `END` at the top of the script to change the asset list or window. The script fails on duplicate rows, missing tickers or bad prices. This README and `sources_metadata.csv` are written by hand and are not regenerated.

## Sources and terms

- **Yahoo Finance** (prices, corporate actions) via the open-source `yfinance` library. Terms: https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html
- **Bank of Canada** Valet API (FX, rates, Canadian CPI). Terms: https://www.bankofcanada.ca/terms/
- **FRED**, Federal Reserve Bank of St. Louis (U.S. rates, CPI, unemployment). The underlying series come from U.S. government agencies. Terms: https://fred.stlouisfed.org/legal/

---

# Jeu de données de départ AlphaForge AI

Données facultatives pour le datathon PolyFinances AlphaForge AI. Vous pouvez les utiliser telles quelles, les compléter ou les ignorer. Tout ici sert à la simulation. Rien ne constitue un conseil en placement.

Période : **12 novembre 2021 au 12 novembre 2026** (5 ans, extraction le 13 novembre 2026). Cinq ans plutôt que trois pour inclure 2022, quand actions et obligations ont reculé en même temps.

## Un point de départ, pas la réponse

Ce jeu de données existe pour vous éviter de perdre vos premières heures à chercher des prix. Ce n'est pas le jeu de données que le jury s'attend à vous voir utiliser, et il ne couvre pas tout ce dont un bon projet a besoin. Changez d'actifs, choisissez une autre période, ou ajoutez des nouvelles, des documents réglementaires, de l'information ESG, la composition de FNB ou toute autre donnée publique utile au problème que vous choisissez. Les personas et les exemples de titres de l'énoncé sont des repères, pas une liste à cocher.

Les meilleurs projets partent souvent d'une question, déterminent les données dont elle a besoin, puis vont chercher ces données. Peu importe ce que vous ajoutez, documentez la source, la date et le traitement, comme le demande l'énoncé.

## Fichiers

| Fichier | Lignes | Contenu |
| --- | --- | --- |
| `assets_universe.csv` | 31 | `asset_id, ticker, name, asset_class, market, currency, sector` |
| `prices_daily.csv` | ~40 000 | `date, ticker, open, high, low, close, adj_close, volume, currency` |
| `corporate_actions.csv` | ~660 | Dividendes et fractionnements par date ex |
| `fx_usdcad_daily.csv` | ~1 250 | `date, usdcad, cadusd`, Banque du Canada |
| `macro_rates.csv` | ~8 300 | Format long `date, series_id, value, unit, frequency, label, source` |
| `sources_metadata.csv` | 6 | Source, date, traitement, limites et conditions pour chaque fichier |
| `build_dataset.py` | | Script qui régénère les cinq fichiers CSV de données |

L'univers compte 10 actions canadiennes, 10 actions américaines, 9 FNB (actions, obligations, or, et ESGV, un FNB américain filtré ESG) ainsi que Bitcoin et Ether. Les séries macro couvrent le taux directeur de la Banque du Canada, les rendements obligataires 2 et 10 ans du Canada et des États-Unis, l'IPC des deux pays, le taux des fonds fédéraux et le chômage américain.

## À savoir avant d'utiliser les données

- **Les prix sont dans la devise de cotation.** Les titres `.TO` sont en CAD, le reste en USD. Utilisez `fx_usdcad_daily.csv` pour convertir. Ce fichier n'a pas de ligne les jours fériés canadiens.
- **Aucun remplissage ni alignement de calendrier.** Une ligne existe seulement les jours où Yahoo fournit un prix pour l'actif (ZST.TO compte une ligne à volume nul, le 2022-07-06). Les jours fériés diffèrent entre la TSX et les marchés américains, et les cryptos se négocient 7 jours sur 7.
- **`adj_close` est ajusté pour les fractionnements et les dividendes** (méthode Yahoo). Utilisez-le pour les rendements. `close` n'est ajusté que pour les fractionnements. Les valeurs passées de `adj_close` changent si vous retéléchargez les données.
- **Tous les prix sont déjà ajustés pour les fractionnements.** Les lignes `split` de `corporate_actions.csv` sont fournies à titre de référence. Ne les appliquez pas de nouveau.
- **Les lignes crypto correspondent à des jours civils UTC** (00 h à 24 h UTC). Il n'y a pas de clôture de marché.
- **CNQ.TO affiche un « fractionnement » de 1,021 le 2022-08-22**, le même jour qu'un dividende de 0,75 $. CNQ n'a pas fractionné ses actions à ce ratio. Il s'agit probablement d'une distribution spéciale. Vérifiez auprès des relations investisseurs de CNQ.
- **Les données macro mensuelles sont datées au mois de référence, pas à la date de publication.** Ne les utilisez pas dans une simulation avant leur publication réelle. Les valeurs FRED sont révisées.
- **Biais du survivant.** L'univers a été choisi en 2026 parmi des titres aujourd'hui importants.
- **Aucune cote ESG, nouvelle ou donnée fondamentale n'est incluse.** Les équipes qui en ont besoin peuvent utiliser les rapports de durabilité des sociétés, les pages méthodologiques ESG des émetteurs de FNB, SEDAR+ et EDGAR, en documentant leurs sources.

## Sources et conditions

Yahoo Finance (via la bibliothèque `yfinance`) pour les prix. Banque du Canada (API Valet) pour le change, les taux et l'IPC canadien. FRED pour les données américaines. Voir `sources_metadata.csv` pour le détail.
