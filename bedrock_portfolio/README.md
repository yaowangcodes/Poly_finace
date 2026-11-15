# AlphaForge callable portfolio tool

`portfolio_skill.py` is a standalone extraction of `demo.ipynb`. It calculates CAD indicators and solves the same convex portfolio objective. It has no Jupyter dependency and makes no network calls or source-file writes.

For **Amazon Bedrock Agents**, expose it as a Lambda-backed action group using **function details**. The entry point is `portfolio_skill.lambda_handler`; the function name is `portfolio_analysis`; the single required string parameter is `request_json`. The handler follows AWS's [function-details event/response contract](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-lambda.html). A Markdown skill file alone does not connect this code to a Bedrock Agent.

## Local use

From the repository root:

```sh
.venv/bin/python bedrock_portfolio/portfolio_skill.py --request '{"profile":"Balanced"}'
.venv/bin/python bedrock_portfolio/portfolio_skill.py --request '{"operation":"indicators"}'
.venv/bin/python bedrock_portfolio/portfolio_skill.py --request '{"profile":"Custom","constraints":{"cash_min":0.2,"bond_min":0.3,"crypto_max":0,"vol_max":0.08}}'
.venv/bin/python -m unittest discover -s bedrock_portfolio -p 'test_*.py' -v
```

You can also import `run(request, data_dir=...)` directly. `ALPHAFORGE_DATA_DIR` overrides the deployment's data directory; agent requests cannot set filesystem paths.

## Inputs

| Field | Default | Meaning |
|---|---|---|
| `operation` | `optimize` | `optimize`, `indicators`, or `list_profiles` |
| `profile` | `Balanced` | One of the six notebook profiles, or `Custom` |
| `constraints` | `{}` | Override specified preset limits; `Custom` starts without optional limits |
| `as_of` | Snapshot end minus one year | Latest permitted estimation date; at least 60 returns required |
| `kappa` | `0.001` | One-off cost per dollar of asset buys + sells |
| `shrink` | `0.5` | Weight on the universe mean in estimated returns |
| `previous_weights` | 90% equal weight + 10% cash | Map of asset tickers to fractions; residual cash; do not include `CASH` |

All limits use fractions: `0.15` means 15%. Supported keys:

- Allocation: `position_max`, `cash_min`, `bond_min`, `equity_max`, `crypto_max`, `usd_max`, `canada_min`, `gold_min`.
- Risk: `vol_max`, `beta_max`, `te_max`, `downside_max`, `cvar_max`, `stress_max`, `hhi_max`.
- Trading: `turnover_max` (gross asset buys + sells; cash excluded).

Volatility, downside and tracking error are annualized. CVaR is a 95% one-common-session loss. Stress assumes equities −30%, bonds −5%, crypto −55%, gold +5%, cash 0, all in CAD. HHI excludes cash; the output also reports HHI including cash. Unknown fields and non-finite numbers are rejected. An infeasible model never returns weights or automatically relaxes limits.

Outputs include `weights` (31 assets plus `CASH`), `metrics`, `exposures`, `constraint_checks`, `provenance` with file hashes and fit date, and all assumptions. Indicator columns ending in `%` are percentage points; other returns and weights are fractions. No holdout/backtest metrics are exposed by this tool.

## Connect to Bedrock

1. Package `portfolio_skill.py`, the six starter CSVs, and `requirements.txt` dependencies into a Lambda deployment. CVXPY and its solvers contain compiled binaries: build for the Lambda Linux architecture, not by copying the Mac `.venv`.
2. A container recipe is provided. From the repository root, build for your chosen Lambda architecture (this example is x86_64):

   ```sh
   docker build --platform linux/amd64 --provenance=false -f bedrock_portfolio/Dockerfile -t alphaforge-portfolio .
   ```

   The Dockerfile-specific ignore list includes only the tool, requirements and CSVs. Publish the image to your own ECR repository and create a matching x86_64 Lambda. Start with 2048 MB memory and a 120-second timeout; measure and adjust. No data-file write permission is needed. This container has not been built or deployed as part of the local task.
3. Attach the normal Lambda execution role for logs. Permit `bedrock.amazonaws.com` to invoke this Lambda using a resource-based policy restricted to your account and agent ARN; follow [AWS's permission instructions](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-permissions.html#agents-permissions-lambda).
4. Add an `AlphaForgePortfolio` action group with **function details** and select the Lambda. `function_schema.json` is the API/SDK `functionSchema` object. In the console, enter its function name, description and parameter definitions. This schema is not an OpenAPI schema.
5. Add the relevant contents of `AGENT_INSTRUCTIONS.md` to the agent's instructions. Prepare the agent and test it, as described in [AWS's action-group setup](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-action-add.html). `example_event.json` is a Lambda console test event.

Example SDK configuration after you supply the existing IDs/ARN:

```python
import json
import boto3
from pathlib import Path

client = boto3.client("bedrock-agent", region_name="YOUR_REGION")
client.create_agent_action_group(
    agentId="YOUR_AGENT_ID",
    agentVersion="DRAFT",
    actionGroupName="AlphaForgePortfolio",
    actionGroupExecutor={"lambda": "YOUR_LAMBDA_ARN"},
    functionSchema=json.loads(Path("bedrock_portfolio/function_schema.json").read_text()),
)
client.prepare_agent(agentId="YOUR_AGENT_ID")
```

No AWS resources are created by the Python tool. AWS integration still requires your deployment, IAM policy, action-group configuration and cloud smoke test. The packaged CSV snapshot is fixed; updating it requires an intentional redeployment or deployment-managed data directory.
