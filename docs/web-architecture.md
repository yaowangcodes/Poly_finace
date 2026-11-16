# AlphaForge web workspace

Next.js App Router + TypeScript web application for the **existing** AlphaForge AgentCore Runtime. Browser → authenticated Next.js API → AWS SDK v3 `BedrockAgentCoreClient` / `InvokeAgentRuntimeCommand` → Strands + STM → unchanged `portfolio_analysis` / CVXPY.

The UI has searchable saved conversations, calendar-date groups, rename/delete, fresh New Chat UUIDs, responsive navigation and constraint drawers, Markdown/GFM/math/code rendering, copy, dark mode, scroll-aware updates, proposal confirmation/rejection and engine-backed portfolio charts/tables. There is no fake model stream, hardcoded chat history, or prose-derived financial data.

## No-sign-in local mode

The local workspace now opens directly without a login screen. `.env` is configured with `WEB_AUTH_MODE=local`, local file persistence and the existing Runtime ARN. Start it with `npm run dev` and open http://localhost:3000. All local browsers deliberately share one owner/workspace; keep this server private to your computer. Host and Origin checks reject non-loopback access, and the dev/start commands bind to loopback by default.

No JWT is fabricated or sent in this mode. Real cloud chat requires the existing Runtime code/configuration to be updated to **IAM single-user mode** as described below. AWS SigV4 credentials are still required server-side; removing the browser login does not make the AWS endpoint anonymous. Existing JWT-backed conversations remain separate from the new local workspace. For a publicly hosted multi-user app, set `WEB_AUTH_MODE=oidc` and configure OIDC instead.

### Matching Runtime configuration (not deployed automatically)

After reviewing the existing Runtime settings and obtaining deployment authorization, use the existing update workflow with:

```sh
export AUTH_MODE=iam_single_user
export SINGLE_USER_ACTOR_ID=alphaforge-local-owner
export AGENTCORE_MEMORY_ID=AlphaForgeConversationSTM-j2yxFXBeaQ
# Set IMAGE_URI to the newly built/pushed image and fetch runtime-current.json
# as documented in bedrock_portfolio/README.md.
.venv/bin/python AlphaForge/bedrock_portfolio/prepare_runtime_update.py
aws bedrock-agentcore-control update-agent-runtime --region us-east-1 \
  --cli-input-json file://AlphaForge/bedrock_portfolio/runtime-update.json
```

The execution code uses only the configured stable actor ID, never a browser-supplied identity. The Runtime must retain IAM inbound authentication; restrict InvokeAgentRuntime to your owner credentials/trusted web role. Every allowed caller intentionally shares this one owner. The update generator refuses to silently convert an existing JWT-authorized endpoint. No OIDC settings are required for this mode. No AWS resources were updated by this local change.

## Run locally

Use Node.js 24 (22+ supported) and pnpm 12.21.0. From the project root:

```sh
npm install --global pnpm@12.21.0
pnpm install --frozen-lockfile
# This checkout already has .env. For a fresh checkout only:
# cp .env.example .env
# Use WEB_AUTH_MODE=local for no browser login; configure the matching Runtime mode before cloud chat.
# Generate SESSION_ENCRYPTION_KEY locally with: openssl rand -base64 32
pnpm dev
```

Open http://localhost:3000. Local mode needs no identity provider. OIDC mode requires a real configured provider. Neither mode uses fake JWTs or anonymous AWS access. The UI's model calls are not a demo: using configured credentials incurs normal cloud charges.

Set `AWS_PROFILE` for your existing local SSO/development profile, or use the normal AWS SDK credential chain. Do not put AWS access keys in `NEXT_PUBLIC_*`, browser storage, source code or client components. Deployed Node.js containers use their IAM execution role. No AWS request runs in browser JavaScript.

## OIDC authentication configuration (multi-user mode only)

Register a **confidential web application** with your existing OIDC provider supporting authorization-code flow, PKCE S256, and RS256-signed ID tokens. Redirect URI: `APP_ORIGIN/api/auth/callback`, e.g. `http://localhost:3000/api/auth/callback` in development and `https://your-domain/api/auth/callback` in production. The issuer and JWKS URLs must be HTTPS.

Configure:

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact public origin; HTTPS outside localhost; also used for mutation Origin checks |
| `AUTH_ISSUER` | Exact ID-token issuer, matching the Python runtime |
| `AUTH_AUDIENCE` | ID-token audience; must equal `OIDC_CLIENT_ID` and match the Python runtime |
| `AUTH_JWKS_URL` | Trusted HTTPS keys endpoint, matching the Python runtime |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Confidential web client; secret is server-only |
| `SESSION_ENCRYPTION_KEY` | 32 random bytes in base64; injected as a secret; shared across replicas |
| `AWS_REGION`, `AGENTCORE_RUNTIME_ARN`, `AGENTCORE_QUALIFIER` | Existing Runtime target, normally `us-east-1` and `DEFAULT` |
| `STORE_DRIVER` | `file` for explicit local development; `dynamodb` for durable multi-instance deployment |
| `ALLOW_LOCAL_FILE_STORE`, `DATA_DIR` | Must explicitly enable local disk persistence; directory must survive local restarts |
| `DYNAMODB_TABLE` | Provisioned application table name; never created by application code |

OIDC state, nonce and PKCE are checked by `openid-client`; the ID token's signature, issuer, audience, subject and expiry are independently verified by `jose`. Each authenticated API request revalidates the token. Server records store the token encrypted with AES-GCM (JWE); browser cookies contain an opaque random session ID only. Cookies are HttpOnly, SameSite=Lax and Secure under HTTPS, with a `__Host-` prefix in production. Server session IDs are hashed before persistence. Tokens are never returned through `/api/me`, conversation JSON, React props or logs. Mutations require an exact Origin match, strict Zod bodies and a 24 KB request-body limit.

The session expires at the earlier of the ID token expiry or one hour. No refresh token is requested or stored. Sign in again after expiry; ownership derived from verified issuer/subject reopens the same conversations. Local sign-out deletes the server session; it does not terminate the identity provider's global SSO session. Configure provider logout separately if required. Secret rotation invalidates existing encrypted sessions and requires login again. Production deployment remains incomplete until actual provider configuration and end-to-end login are verified.

## Conversation persistence and ownership

AgentCore STM remains the authoritative source for agent history and confirmed/pending investment constraints. The **web store** persists navigation, titles, display messages, backend revisions and last acknowledged structured results. The web layer does not replace STM.

- `FileStore`: permission-restricted files, atomic rename, cross-process file locks and conditional version checks. Survives local server/browser restarts. Explicitly local-only: no ephemeral/serverless/multi-host deployment. Protect the machine and `.data`; conversation text is not encrypted at rest by this adapter. Session tokens are encrypted. Expired local session records should be periodically removed by an operator.
- `DynamoStore`: owner-partitioned records, strongly consistent reads, paginated queries and conditional Put/Delete. Designed for multiple web instances. Session records use `ttl`; identity checks enforce expiry even before DynamoDB TTL deletes an item. Table encryption, backup policy, retention and least-privilege deployment are operator responsibilities.

Every conversation API derives the owner from the server session, never from a request field. Reads, turns, renames, deletes and stop-waiting requests all enforce this ownership. Requests cannot override actor ID, Runtime session UUID or backend revision. A durable conditional write reserves a turn before invocation, rejecting overlapping tabs/instances. The SDK has `maxAttempts: 1`: ambiguous invocations are never automatically retried.

New Chat creates one stored web record with a cryptographically random UUID, null revision, empty messages and no constraints/proposal. It invokes neither a model nor Memory. Only the first actual turn sends `new_conversation: true`. Thereafter the stored session ID and last successful backend revision are reused. New Chat never changes an existing record. Reopening merely reads the web record; it does not reinitialize STM. The active selection defaults to the most recently updated chat on reload; all conversations remain available.

Delete requires confirmation and removes the web record. **It does not erase AgentCore STM events**, which remain under configured retention. Full regulatory erasure needs a separately authorized operator workflow. Renaming changes only metadata. Processing chats cannot be renamed or deleted.

Storage is deliberately bounded: a 110 KB transcript threshold before the next turn, 180 KB Runtime response ceiling and 300 KB persisted-item limit keep records below DynamoDB's item limit. The UI sidebar loads the owner's saved records, so a very large conversation index will need a paginated metadata-only endpoint in a future scale-out. There is no unbounded-document database dependency.

## Turn handling, constraints and uncertain outcomes

Natural-language edits are proposed by the model and returned as `proposed_constraints`. The amber proposal card shows old → proposed values, distinct from confirmed limits. Confirm sends `confirm_proposal: true`; discard sends the newly supported `reject_proposal: true`. Rejection is deterministic in Python and makes no model call. It preserves confirmed values and records the rejection in STM history. Empty patches are never used as rejection signals.

Direct editing validates against `src/lib/constraint-limits.json`, generated from the unchanged engine `LIMIT_MAX`; percentages are converted to fractions and beta/HHI remain unitless. The review dialog requires a separate Confirm and apply action. Neither the UI nor server optimistically changes confirmed limits. Acknowledged limits and proposals always come from the Runtime response. Named presets are illustrative; only user approval establishes a requirement.

An invocation deadline is 180 seconds; hosting/proxy request limits must exceed 240 seconds. The integration returns complete responses, with honest progress indication rather than simulated streaming. Stop waiting aborts the browser fetch, **not** the model. The follow-up `stop-waiting` API either retrieves an already reserved/completed turn or conditionally fences an unclaimed request so it cannot arrive later with its old version. Processing conversations poll for acknowledgement. If a process dies, a processing record older than four minutes becomes uncertain on retrieval, never reusable automatically. Web and STM operations are not one transaction.

Memory errors, malformed/mismatched responses, unsupported rejection, timeouts, connection loss and final persistence failure all block the conversation rather than guessing its revision. If the browser cannot reach even the follow-up API, the local UI remains uncertain; refresh after connection recovery. An advisory ID/version marker in localStorage survives browser restarts and triggers server reconciliation before the next turn; it contains no token or financial data. A late response cannot overwrite another state because final writes use the reserved version. Refresh can reveal a completed result; otherwise start a **new** conversation explicitly and review/reconfirm every desired limit. Never assume the old turn did not execute, reset its revision or silently drop restrictions. Server authentication failures preserve saved chats and require signing in again.

The runtime's success envelope now adds `protocol_version: 2` and `portfolio_results`, directly captured from the real tool (including infeasible results). Old successful envelopes still render text without charts; discard requires v2. Engine output, constraints, defaults, snapshots, risk calculations and CVXPY were not changed. Charts use only real returned weights including CASH, metrics and constraint checks. Missing asset categories and per-asset risk/return data are labeled unavailable. Constraint violation display uses the existing engine tolerance `2e-6`; binding comes from the engine's flag. No metric is extracted from arbitrary assistant text.

## Verify and update the existing Runtime

Target supplied for this project:

- Runtime: `AlphaForgePortfolio-TevjcpB3OT`
- ARN: `arn:aws:bedrock-agentcore:us-east-1:339712771896:runtime/AlphaForgePortfolio-TevjcpB3OT`
- STM: `AlphaForgeConversationSTM-j2yxFXBeaQ`
- Region: `us-east-1`

These identifiers are configuration, **not a verified live status**. No deployment or runtime invocation was performed during implementation. From the repository root, inspect without modifying resources:

```sh
aws bedrock-agentcore-control get-agent-runtime --region us-east-1 \
  --agent-runtime-id AlphaForgePortfolio-TevjcpB3OT
aws bedrock-agentcore-control get-agent-runtime-endpoint --region us-east-1 \
  --agent-runtime-id AlphaForgePortfolio-TevjcpB3OT --endpoint-name DEFAULT
aws bedrock-agentcore-control get-memory --region us-east-1 \
  --memory-id AlphaForgeConversationSTM-j2yxFXBeaQ
```

Confirm Runtime and endpoint READY, matching runtime version, Memory ACTIVE, expected image tag, STM ID and all three `AUTH_*` values. Model availability requires an authorized smoke invocation; read-only status alone cannot establish it.

The Python runtime must be updated to include structured results/rejection. Follow [the existing runtime update instructions](../AlphaForge/bedrock_portfolio/README.md), set `AGENTCORE_MEMORY_ID=AlphaForgeConversationSTM-j2yxFXBeaQ`, and **skip Memory creation**. Use a new image tag. After authorization and local review, the exact update remains:

```sh
aws bedrock-agentcore-control update-agent-runtime --region us-east-1 \
  --cli-input-json file://AlphaForge/bedrock_portfolio/runtime-update.json \
  > AlphaForge/bedrock_portfolio/runtime-updated.json
```

`prepare_runtime_update.py` generates that input from the current deployed configuration. Do not create a second Runtime. Existing conversations on incompatible deployed versions must not be run concurrently across versions. The web app signs calls with IAM and forwards the same verified ID token to Python; configure Python audience to this web OIDC client's ID.

## Production storage and web deployment — do not run without authorization

`../infra/create-table.json` and `../infra/web-role-policy.template.json` are reviewable configuration only. The app never provisions resources. After authorization, a deployer can create the dedicated web table, enable session TTL and backups:

```sh
aws dynamodb create-table --region us-east-1 --cli-input-json file://infra/create-table.json
aws dynamodb wait table-exists --region us-east-1 --table-name AlphaForgeWeb
aws dynamodb update-time-to-live --region us-east-1 --table-name AlphaForgeWeb \
  --time-to-live-specification 'Enabled=true,AttributeName=ttl'
aws dynamodb update-continuous-backups --region us-east-1 --table-name AlphaForgeWeb \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

Review region, name, encryption key requirements, data retention, deletion protection and costs first. The web IAM role needs only InvokeAgentRuntime on the existing Runtime/endpoint and GetItem/PutItem/DeleteItem/Query on this table. The Memory permissions remain on the **AgentCore execution role**, not the web role. Substitute the policy template locally; attach it only after authorization. IAM credentials and secret values belong in your hosting platform's role/secret configuration, not an image or public env variables.

Build locally:

```sh
pnpm build
pnpm start  # copies static assets into the standalone build and starts it
# Optional container build from repository root:
# docker build -t alphaforge-web:review .
```

Deploy the standalone Node.js server/container to your approved host behind HTTPS. Configure `WEB_AUTH_MODE=oidc`, persistent DynamoDB, `STORE_DRIVER=dynamodb`, `ALLOW_LOCAL_FILE_STORE=false`, public origin, OIDC settings, Runtime ARN and server secrets. Set proxy and host timeouts above 240 seconds, avoid platform automatic POST retries, and allow outbound HTTPS to OIDC/JWKS, DynamoDB and AgentCore. Configure access-log redaction, monitoring, user quotas/rate limiting/WAF and backup/erasure operations for your traffic before public rollout. The repository includes no automatic deployment command or infrastructure executor. Do not host this app as a static export.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
python3 -m unittest discover -s AlphaForge/bedrock_portfolio -p 'test_*.py' -v
```

Tests mock AWS transports; no cloud charges. They cover UUID creation, persistence/restart, session/revision forwarding, switching, constraint preservation, proposal confirm/reject, ownership and user isolation, concurrent turns, memory failure/timeouts, canceled-request fencing, actual signature checks, CSRF origin checks, chart/table values, missing metrics, direct-edit review, navigation/drawer and composer interactions. Python tests exercise real Strands/session management and CVXPY with mocked transports. Two notebook-reference checks skip if their source CSVs are absent.

Before production, perform an **authorized** end-to-end smoke test with two real users: login/logout/expiry, new chat without model invocation, three confirmed limits, cash-only change, confirmation, discard, page/browser restart, another user's URL, memory outage, ambiguous timeout, and one structured optimization. Verify deploy readiness separately. Automated tests cannot establish deployed IAM, IdP, model availability or real model interpretation accuracy.

Official references: [AgentCore JavaScript SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-agentcore/command/InvokeAgentRuntimeCommand/), [AWS Strands Memory integration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/strands-sdk-memory.html), [Next.js App Router](https://nextjs.org/docs/app/getting-started/installation), [openid-client](https://github.com/panva/openid-client), [DynamoDB conditional writes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html).


### Automatic connection check

After workspace authentication, the UI calls `/api/health` once and restores the existing server-side conversation list independently. The status shows Connecting, Ready, or Disconnected; Retry connection repeats only the read-only check. This uses AWS `GetAgentRuntimeEndpoint`, `GetAgentRuntime` for that endpoint's live version, and `GetMemory`. It never invokes a model or creates a session. The ten-second deadline also bounds credential resolution. Ready means the control-plane configuration checks passed, not that model access, execution-role Memory permissions, or deployed application protocol have been smoke-tested. This indicator is advisory; existing turn validation remains authoritative.

Use the existing `AGENTCORE_RUNTIME_ARN` variable (not `AGENT_RUNTIME_ARN`). Optionally set `AWS_PROFILE` to an existing local profile. AWS credentials stay on the server and the SDK resolves them automatically; temporary sessions can still expire and require developer reauthentication. Do not put access keys in the browser. On AWS hosting, use the server IAM role.

The server role/profile now also needs `bedrock-agentcore:GetAgentRuntime`, `bedrock-agentcore:GetAgentRuntimeEndpoint`, and `bedrock-agentcore:GetMemory`; the policy template scopes them to the configured resources and uses `AGENTCORE_MEMORY_ID` for substitution. No permissions have been applied automatically. Failed checks preserve chats and constraints. Existing `/api/conversations/[id]/turn` remains the sole chat endpoint, with server-owned session IDs, revisions, and serialized updates; no parallel `/api/chat` route is needed.

Official API references: [GetAgentRuntimeEndpoint](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GetAgentRuntimeEndpoint.html), [GetMemory](https://docs.aws.amazon.com/bedrock-agentcore-control/latest/APIReference/API_GetMemory.html).
