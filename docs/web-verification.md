# Verification handoff

Local checks completed on November 15, 2026:

| Check | Result |
| --- | --- |
| ESLint | Passed, no warnings |
| TypeScript `tsc --noEmit` | Passed |
| Vitest | 25 tests passed across 5 files |
| Next.js production build | Passed; application and API routes generated |
| Standalone production startup | Passed; static assets copied by `scripts/start.mjs` |
| Python regression/integration suite | 28 passed, 2 skipped (missing notebook output CSVs) |
| Desktop visual inspection | Initial signed-out Safari rendering inspected; initial-scroll issue corrected afterward |
| Full mobile/dark-mode visual inspection | Not completed: native browser automation stalled; responsive controls covered by component tests |
| Real OIDC sign-in / logout | Not verified; provider credentials have not been configured |
| Live AgentCore / Memory / DynamoDB | Not invoked or modified; no deployed readiness claim |
| Runtime Docker image build | Passed locally for linux/arm64, tagged `alphaforge-portfolio:stm-local` |

All automated AWS tests use mocked transports. JWT tests use test-only signed keys, never a production authentication bypass. No runtime, Memory resource, DynamoDB table or IAM policy was deployed or changed. Temporary Node.js tooling was used because the default shell had no Node/npm; standard Node 24 and pnpm setup is documented in README.md. Local QA server has been stopped.

Before rollout: configure a real OIDC web client, matching Runtime AUTH_* settings, secret injection and durable DynamoDB; update the existing Runtime image for protocol v2; verify runtime/endpoint READY and Memory ACTIVE; then authorize a two-user cloud smoke test. See README.md for the exact configuration and commands.

Repository deployment snapshot: `bedrock_portfolio/deployment.json` records runtime version `1` with status `CREATING`; `agentcore-runtime.json` contains only `AWS_REGION` and `BEDROCK_MODEL_ID` environment settings. These are local historical files, not live AWS status. They do not establish that STM/authentication or protocol v2 has been deployed. Regenerate the update input from a current `get-agent-runtime` response as documented; do not reuse the old create-runtime file for an update.

No-sign-in update: local single-user mode is now configured in the ignored `.env.local`; it uses no provider token or sign-in cookie and rejects non-loopback/cross-origin access. OIDC remains available for multi-user hosting. The corresponding Runtime `AUTH_MODE=iam_single_user` implementation is local code only and has not been deployed. Updated checks: lint and TypeScript passed; 28 web tests passed; 29 Python tests passed with 2 notebook-reference skips. The production build was rerun with the local configuration.

Container verification: the ARM64 Runtime image built successfully. Optimizer and conversation suites ran inside it with `--network none`: 21 passed, 2 optional notebook-reference tests skipped. Test-only modules and the web constraint schema were mounted read-only; no AWS credentials were mounted. An initial run omitted two test fixtures and was corrected before the successful run. The image has not been pushed.

Read-only AWS readiness checks were attempted but failed because developer credentials expired. AWS CLI 2.40.3 is installed. The user authorized `aws login`; browser authentication is pending. A fresh Runtime configuration and update JSON cannot yet be verified. No cloud resources have been modified and no model calls have been made.

Automatic connection update: authenticated `/api/health` checks the endpoint live version, Runtime configuration and Memory status using read-only control-plane commands with a ten-second deadline. UI includes Connecting/Ready/Disconnected and manual retry independently of saved-chat restoration. Verified 33 web tests across 7 files, lint, TypeScript, and production build. Tests include expired credentials, undeployed Memory configuration, deadline handling, and UI retry without model invocation. No live health request, IAM update, deployment, or model invocation was performed for this change.

Connection failure diagnosis: the running localhost `/api/health` returned disconnected with “The deployed Runtime is not ready or has no conversation Memory configured.” Added turn preflight before reservation/model invocation; known configuration failures return HTTP 424. UI refreshes the unchanged conversation for this response instead of fencing it as uncertain. Existing uncertain records are not reset. Regression coverage verifies both server preservation and UI handling. No model invocation or AWS mutation was performed.
