# AlphaForge conversational portfolio agent

**AgentCore Runtime → Strands + AgentCore Memory STM → portfolio_analysis → unchanged CVXPY.** Each request constructs a fresh agent and restores its messages and structured state through `AgentCoreMemorySessionManager`. No LTM strategies, cross-session preference extraction, external database, LangGraph, or MCP service is used.

`portfolio_skill.py`, its mathematics, constraints, profiles, defaults, CSV data, and legacy Lambda contract are unchanged. The runtime wraps the existing tool to enforce confirmed session limits. With confirmed limits it always uses Custom and the complete confirmed set; otherwise illustrative presets retain the engine's behavior. No shorting/no leverage always apply. Defaults remain Balanced, kappa=.001, shrink=.5, the estimation date reserving the final year, and assumed 90% equal-weight assets/10% cash prior holdings.

## Identity and Cloud API contract

The existing IAM/SigV4 Runtime endpoint, `/invocations`, `/ping`, port 8080, and `status`/`response` success fields remain. **Prompt-only clients must add the fields below.** They now fail validation rather than silently running without identity or memory. There is no separate Cloud API application in this repository to update.

Configure `AUTH_ISSUER`, `AUTH_AUDIENCE`, and `AUTH_JWKS_URL` for an existing identity provider issuing RS256 JWTs with `iss`, `sub`, `aud`, and `exp`. The server verifies signature, expiry, issuer, and audience against this fixed configuration; actor ID is SHA-256 of verified issuer/subject. Tokens from a different issuer/audience, unsigned tokens, arbitrary `actor_id` fields and expired tokens are rejected. JWKS URLs come only from deployment configuration. Use an audience dedicated to this application; do not use an app-only/client-credentials token as an end-user token. No identity provider is provisioned by this change.

Your Cloud API must authenticate each end user, forward their signed token, maintain a session UUID and last revision per conversation, and serialize requests per session. Generate a fresh UUID for New conversation. Pass the same UUID as AWS `runtimeSessionId` and JSON `session_id`. Never reuse sessions between users or send parallel turns. Actor-scoped hashed Memory session IDs prevent collision even if two users supply the same UUID, including the SDK's legacy fallback namespaces. Runtime context must match the payload UUID. A process-independent file lock serializes workers in a runtime microVM; it is **not a distributed lock**. The supported topology is one Runtime session/microVM per conversation, with single-flight Cloud API calls, including during runtime version transitions. STM offers no compare-and-swap transaction; do not route the same conversation concurrently to multiple versions/runtimes.

First request (the token is an authentication credential, not model input):

```json
{
  "prompt": "Build a portfolio with these confirmed limits.",
  "identity_token": "<signed-user-JWT>",
  "session_id": "8ba393d8-9edc-4db9-bf94-f494125533cf",
  "new_conversation": true,
  "confirmed_constraints": {"crypto_max": 0, "cash_min": 0.2, "vol_max": 0.08}
}
```

The result adds `session_id`, `revision`, `confirmed_constraints`, and `proposed_constraints`. Persist the returned revision in your client. A subsequent update sends the same session and current identity token:

```json
{
  "prompt": "Raise cash to 30%, keeping my other limits.",
  "identity_token": "<signed-user-JWT>",
  "session_id": "8ba393d8-9edc-4db9-bf94-f494125533cf",
  "revision": "<last-response-revision>",
  "confirmed_constraints": {"cash_min": 0.3}
}
```

This retains crypto_max=0 and vol_max=.08. `confirmed_constraints` is an explicitly user-approved **patch**, never a replacement; null explicitly removes a key. Only send this field after the user has approved its numeric values. Unknown, boolean, nonfinite and out-of-range values fail the engine's existing validation. Infeasible confirmed combinations remain saved and return infeasible; they are never relaxed.

For natural-language-only updates, omit `confirmed_constraints`. The agent calls `propose_constraints`; its patch is saved separately and returned as `proposed_constraints`. Show it to the user. Their approval sends `confirm_proposal: true` with the latest revision. That merges only the pending keys. A plain “yes” does not authorize a state mutation. While a proposal is pending, optimization is blocked. Suggestions and presets never automatically become confirmed requirements. To override or discard a proposal, submit an explicit confirmed patch; a nonempty patch clears the proposal.

## Failure and retention behavior

`agent.state['portfolio']` stores schema version, confirmed constraints, pending proposal and revision. Confirmed changes are persisted **before** calling the model; state is synced and read back before releasing the answer. SDK read-error fallbacks are made fail-closed. An expired/missing session, missing state/history, stale revision, denied access, read/write error, or model error returns `conversation_unavailable` without a portfolio response. New conversations cannot overwrite an existing ID. There is no stateless fallback.

STM writes are not transactional: a failed/timed-out turn may already have saved changes or partial messages. Do not automatically retry or reset that session, especially following a lost response. The smallest safe recovery is an explicit new UUID with all limits reviewed and reconfirmed. There is no automatic in-place recovery endpoint. The revision rejects stale successful-turn retries; it is not an exactly-once request token. Restoration is capped at 10,000 events and fails explicitly above that cap. STM event expiry also means very old conversations need explicit restart. Configure retention deliberately (example below: 30 days).

Tokens are never passed to Strands/Memory or logged by application error handlers. Keep API request-body logging disabled/redacted in your Cloud API and runtime observability configuration. Memory contains user conversation text and constraints; restrict execution-role and operator access. JWT verification requires HTTPS access to the configured JWKS endpoint.

## Local verification

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r bedrock_portfolio/requirements.txt
.venv/bin/python -m unittest discover -s bedrock_portfolio -p 'test_*.py' -v
```

Tests use real Strands and the actual AgentCore session manager with fake AWS transports, including paginated event restoration, plus real JWT signature validation and CVXPY calculations. They make no cloud/model calls. Two optional notebook regression checks require the original notebook output CSVs. Test coverage includes incremental updates, proposal confirmation, user/session isolation, new sessions, memory failures/expiry, stale revisions, tool consistency and infeasibility. Mocked model tests do not establish live language interpretation accuracy.

Docker retains Python 3.13/Linux ARM64 and the pinned numerical dependencies, Strands 1.65.0 and AgentCore 1.26.0. It now includes `conversation.py` and pinned `PyJWT[crypto]`. Both SDK pins already provide the supported memory integration.

```sh
docker buildx build --platform linux/arm64 --provenance=false --load \
  -f bedrock_portfolio/Dockerfile -t alphaforge-portfolio:stm .
docker run --rm -p 127.0.0.1:8080:8080 alphaforge-portfolio:stm
# /ping works without credentials. Local /invocations also needs the
# X-Amzn-Bedrock-AgentCore-Runtime-Session-Id header matching session_id.
```

## IAM and deployment (instructions only; requires authorization)

No AWS resource changes, deployment, or billable calls are performed by installation/tests. Review the target account, role, identity-provider configuration, retention and charges before running the following. Use AWS CLI v2. Existing IAM inbound authentication is preserved.

The runtime execution role keeps its existing Bedrock model/inference-profile, ECR pull and CloudWatch permissions. Add `memory-policy.template.json`, scoped to **one** Memory ARN: CreateEvent, ListEvents and DeleteEvent (used by the supported SDK for redaction/migration). No LTM retrieval or Memory control-plane permissions are needed by runtime code. Do not give end users direct Memory access. The deployer needs CreateMemory/GetMemory, UpdateAgentRuntime and read APIs, ECR push and iam:PassRole; attaching the policy also needs iam:PutRolePolicy. If using a customer KMS key, configure its key policy and required grants per AWS Memory documentation. Keep existing execution-role trust restrictions.

Set configuration locally (issuer/JWKS/audience are public configuration, not secrets):

```sh
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=339712771896
export AGENT_RUNTIME_ID=AlphaForgePortfolio-TevjcpB3OT
export AGENT_RUNTIME_ARN="arn:aws:bedrock-agentcore:${AWS_REGION}:${AWS_ACCOUNT_ID}:runtime/${AGENT_RUNTIME_ID}"
export AUTH_ISSUER=https://YOUR_IDP_ISSUER
export AUTH_AUDIENCE=YOUR_ALPHAFORGE_AUDIENCE
export AUTH_JWKS_URL=https://YOUR_IDP_JWKS_ENDPOINT
export ECR_REPOSITORY=alphaforge-portfolio  # verify existing repository name
export IMAGE_TAG=stm-v2
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_URI="${ECR_REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"
```

After authorization, create an STM-only resource (omit creation if using an existing dedicated STM-only resource):

```sh
aws bedrock-agentcore-control create-memory --region "$AWS_REGION" \
  --name AlphaForgeConversationSTM --event-expiry-duration 30 \
  --memory-strategies '[]' > bedrock_portfolio/memory-created.json
export AGENTCORE_MEMORY_ID="$(.venv/bin/python -c 'import json; print(json.load(open("bedrock_portfolio/memory-created.json"))["memory"]["id"])')"
aws bedrock-agentcore-control get-memory --region "$AWS_REGION" --memory-id "$AGENTCORE_MEMORY_ID"
```

Wait for Memory status ACTIVE. Read the current runtime configuration, generate update/policy files locally, and inspect them:

```sh
aws bedrock-agentcore-control get-agent-runtime --region "$AWS_REGION" \
  --agent-runtime-id "$AGENT_RUNTIME_ID" > bedrock_portfolio/runtime-current.json
.venv/bin/python bedrock_portfolio/prepare_runtime_update.py
.venv/bin/python - <<'PY'
import json, os
from pathlib import Path
from string import Template
p = Path('bedrock_portfolio/memory-policy.template.json')
Path('bedrock_portfolio/memory-policy.json').write_text(
    json.dumps(json.loads(Template(p.read_text()).substitute(os.environ)), indent=2) + '\n')
PY
```

`runtime-update.json` preserves the deployed role, model ID, environment, network, authorizer and optional settings while updating only the image and four memory/authentication settings. This avoids replacing the runtime or changing its inbound IAM API. Do not put user tokens or credentials in the configuration files.

After reviewing generated files and obtaining authorization:

```sh
export EXECUTION_ROLE_NAME=YOUR_EXISTING_RUNTIME_EXECUTION_ROLE_NAME
aws iam put-role-policy --role-name "$EXECUTION_ROLE_NAME" \
  --policy-name AlphaForgeSTM --policy-document file://bedrock_portfolio/memory-policy.json
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker tag alphaforge-portfolio:stm "$IMAGE_URI"
docker push "$IMAGE_URI"
aws bedrock-agentcore-control update-agent-runtime --region "$AWS_REGION" \
  --cli-input-json file://bedrock_portfolio/runtime-update.json \
  > bedrock_portfolio/runtime-updated.json
aws bedrock-agentcore-control get-agent-runtime --region "$AWS_REGION" \
  --agent-runtime-id "$AGENT_RUNTIME_ID"
aws bedrock-agentcore-control get-agent-runtime-endpoint --region "$AWS_REGION" \
  --agent-runtime-id "$AGENT_RUNTIME_ID" --endpoint-name DEFAULT
```

Wait until runtime and DEFAULT endpoint are READY and the endpoint targets the returned runtime version. For a separately managed endpoint, explicitly update it to that version with `update-agent-runtime-endpoint --agent-runtime-id "$AGENT_RUNTIME_ID" --endpoint-name YOUR_ENDPOINT --agent-runtime-version VERSION`. Start fresh UUIDs when switching versions; do not send concurrent requests to old and new versions of a conversation.

An authorized cloud smoke test uses a protected local JSON file containing a real user token and the first-request shape above:

```sh
export RUNTIME_SESSION_ID=8ba393d8-9edc-4db9-bf94-f494125533cf
aws bedrock-agentcore invoke-agent-runtime --region "$AWS_REGION" --cli-read-timeout 300 \
  --agent-runtime-arn "$AGENT_RUNTIME_ARN" --qualifier DEFAULT \
  --runtime-session-id "$RUNTIME_SESSION_ID" --content-type application/json \
  --accept application/json --payload fileb://bedrock_portfolio/request.private.json \
  bedrock_portfolio/cloud-response.json
```

This incurs Runtime, Memory and model charges. Verify a three-constraint first turn, a cash-only update, restoration after runtime recycling, another user's session, explicit new conversation, and denied Memory access. No live cloud success is claimed by the offline tests. Protect/delete local token files and never commit them.

## Official references checked

- [AWS Strands Memory integration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/strands-sdk-memory.html)
- [Strands AgentCoreMemorySessionManager](https://strandsagents.com/docs/integrations/session-managers/agentcore-memory/)
- [AWS runtime identity security](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-security-best-practices.html): user-id headers are opaque, not proof of authenticated ownership.
- [CreateMemory CLI](https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore-control/create-memory.html)
- [UpdateAgentRuntime CLI](https://docs.aws.amazon.com/cli/latest/reference/bedrock-agentcore-control/update-agent-runtime.html)
- [AWS service authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_bedrock-agentcore.html)

Implementation behavior was also checked against installed `bedrock-agentcore==1.26.0` and `strands-agents==1.65.0` source, including state hooks and swallowed read errors. Runtime session IDs alone do not enable Memory; this application explicitly attaches the supported session manager.

## Web interface and v2 response additions

The [AlphaForge Next.js workspace](../web/README.md) provides server-side OIDC authentication, a persisted conversation index, chat navigation and structured portfolio visualizations. Its server signs calls to this existing Runtime using the AWS JavaScript SDK; browser JavaScript receives no AWS credentials or identity tokens.

Successful Runtime responses now also include `protocol_version: 2` and `portfolio_results`, a list of actual optimizer tool outputs from that invocation. Text-only clients can ignore these additive fields. Financial figures are never extracted from prose. No CVXPY/engine code changed.

`reject_proposal: true` is an explicit additive action, mutually exclusive with `confirm_proposal` and `confirmed_constraints`. It clears only the pending proposal, records a deterministic response in history without invoking the model, preserves confirmed limits, and returns a new revision after persistence verification. The same authenticated identity/session/revision checks apply. The web UI uses this action for Discard; an empty confirmed patch remains unrelated to rejection.

The existing Memory ID supplied for the web integration is `AlphaForgeConversationSTM-j2yxFXBeaQ`. Set that ID and skip creation when following the update steps above. Check live readiness and auth configuration before any authorized smoke test; the repository configuration does not prove deployed status.


## Optional IAM single-user workspace

For the localhost web interface without browser sign-in, deploy this code with `AUTH_MODE=iam_single_user` and a stable `SINGLE_USER_ACTOR_ID` (letters, digits, underscores or hyphens; 1–100 characters). Keep the existing Runtime IAM/SigV4 inbound authentication and restrict invocation permissions to the owner or trusted web role. All authorized callers deliberately share this single owner, with separate conversation UUIDs. Payload actor IDs remain rejected, and no JWT is fabricated. `AUTH_MODE` defaults to `jwt`, preserving the existing multi-user authentication behavior unless explicitly changed.

The update generator accepts these two settings in place of OIDC settings for single-user mode and refuses an existing JWT authorizer configuration rather than changing it implicitly. This change has not been deployed. See [the local web setup](../web/README.md) for the exact configuration and update workflow.

### Workshop terminal deployment

If Workshop credentials were exported only in your terminal, the coding agent's shell does not inherit them. After deployment approval, run `bash bedrock_portfolio/deploy_single_user.sh` from that authenticated terminal. This script validates account 339712771896 and the existing HTTP Runtime, endpoint, STM and ECR repository before making changes. It builds an ARM64 image, pushes a unique tag, adds a uniquely named policy scoped to the existing Memory, updates the existing Runtime and waits up to ten minutes for DEFAULT to target the new READY version. It never invokes a model. Current configuration and results are saved with private permissions under `bedrock_portfolio/deployments/`; do not commit those files. Failure stops the script without an automatic rollback; inspect its artifacts before retrying. Each successful rerun adds a new Memory policy, so do not use repeated runs as a status check.
