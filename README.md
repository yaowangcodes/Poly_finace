# AlphaForge

A Next.js website with React pages and server API routes in one application. The server calls the existing AWS AgentCore Python service; AWS credentials stay on the server.

## Run locally

Use Node.js 22 or later (24 recommended). Run commands from this folder, `Poly_finace`:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). This checkout already has a configured `.env`. For a fresh checkout, copy `.env.example` to `.env` and fill in your configuration. Local mode uses a shared workspace without website sign-in.

The project-root `.env` contains app settings and AWS credentials. Next.js loads it automatically; `.env.local` and exported terminal variables can override it. After replacing expired Workshop credentials, restart the server. Keep `.env` private and untracked. Saved local conversations live in `.data/`.

## Production build

```bash
npm run build
npm start
```

The startup script loads the current root `.env`, serves the standalone build, and keeps file storage in the same root `.data/` directory used during development.

Or run the production website in Docker:

```bash
docker compose up --build -d
docker compose logs -f web
```

Docker Compose exposes the website at localhost:3000, injects `.env` at runtime, and stores chats in a persistent `chat-data` volume. Secrets and research datasets are excluded from the image. Stop with `docker compose down`; the volume remains.

For public hosting, use OIDC authentication, DynamoDB storage, and the existing [AWS deployment infrastructure](AlphaForge/infra/web-deploy/README.md). Local mode accepts localhost requests only. This refactor does not deploy or change AWS resources.

## Project layout

| Path | Purpose |
| --- | --- |
| `src/app/` | Website pages, layout, styles, and server API routes |
| `src/components/` | React interface components |
| `src/lib/server/` | Authentication, persistence, and AWS integration |
| `public/` | Static website assets |
| `tests/` | Website and server tests |
| `scripts/start.mjs` | Production startup |
| `infra/` | Website IAM and database templates |
| `AlphaForge/bedrock_portfolio/` | Deployed Python agent source and deployment scripts |
| `AlphaForge/infra/web-deploy/` | AWS website hosting infrastructure |
| `alphaforge_starter/`, `bedrock_portfolio/`, `demo.ipynb`, `notebook_outputs/` | Original research and notebook files |
| `docs/` | Detailed architecture and verification notes |

## Checks

```bash
npm run lint
npm run typecheck
npm test
```

The tests mock AWS calls. Actual chat requires valid AWS credentials and the configured AgentCore runtime. `/api/live` checks the website process; `/api/health` checks the AWS connection without invoking a model.

## Adaptive text investor interview

Open [http://localhost:3000/interview](http://localhost:3000/interview) or use the interview link above the optimizer. The flow asks one question at a time, offers answer choices, “Not sure,” and free text, and saves a single resumable interview per authenticated user. Local workspace mode shares one interview. Restarting replaces that saved interview, so download the JSON first if you want to retain it.

The profile covers objective, horizon, risk willingness, capacity for loss, liquidity, income stability, experience, exclusions and strictness, crypto maximum, optional return target, other restrictions, and optional sizing amount/currency. Answer buttons and high-confidence free-text interpretations work without inference. Ordinary answers such as “I want to grow my savings,” “in four years,” and “no cryptocurrency” update the corresponding fields. `INTERVIEW_MODEL_ID` (or `BEDROCK_MODEL_ID`) enables Bedrock Converse for interpreting free text and generating contextual follow-ups, including additional conflicts. Set it to a Converse-compatible model or inference profile available to your AWS account. The current local configuration reuses the model named in the existing AlphaForge deployment. The server's AWS identity needs `bedrock:InvokeModel` on that model and, when applicable, its inference profile and routed foundation models. Model access and IAM permissions have not been changed by this feature.

`GET /api/interview` resumes the saved state; `POST /api/interview` accepts a versioned answer, edit, restart, or confirmation; `GET /api/interview?download=1` downloads `investor-profile.json`. Authentication, origin protection, bounded input, owner isolation, and optimistic version checks use the existing server infrastructure. Every accepted free-text submission preserves the original response in history and shows it alongside any extracted fields. Clear answers advance; genuinely unclear answers produce a distinct clarification with useful choices. If inference is unavailable or returns invalid data, the original answer is retained and unsupported profile values remain unchanged. Enter submits text, while Shift+Enter adds a new line. Free-text model output is schema-validated before persistence; profile review remains necessary to check interpretation.

Required unknowns and unresolved conflicts block profile confirmation. “Not sure” first provides help, then lets users move on while retaining a required field as unknown. Review and Revisit let them complete it later. Optional unknowns stay null. The JSON preserves `status`, `profile`, `unresolved_conflicts`, `next_question`, and `ready_for_review`, with history and handoff metadata alongside them.

The export includes only explicitly supported optimizer constraints such as `crypto_max`. Qualitative risk tolerance is never converted directly to volatility. The handoff always marks optimization as pending translation and validation: the existing AlphaForge API still needs eligible-asset support, verified exclusions, and numeric policy mappings. The interview does not invoke optimization or sizing automatically.

### Profile coverage

The questionnaire now includes age, occupation, household and financial dependants, goal descriptions, retirement status and timing, sector interests, diversification and company-type preferences, environmental/social/governance priorities, controversy avoidance, and separate account/tax and regulatory restrictions. Personal context can be declined explicitly. These details are recorded as stated and never used to invent a risk tolerance or numeric optimizer limit.

Retirement timing is asked only when planning retirement. When near-term liquidity is needed, the interview collects an exact reserve amount, portfolio currency, and months until the first withdrawal (0–12). An impossible reserve exceeding the recorded portfolio value triggers clarification. No reserve questions are asked when the user reports no near-term withdrawals. Editing an underlying answer resets dependent answers so stale timing is not reused.

Existing saved interviews are normalized to the expanded schema on resume and download. Earlier answers and history are retained; new questions are presented and old confirmation is invalidated until the applicable new questions are covered. The export includes the expanded profile, ESG instructions, and liquidity reserve details. The handoff still reports pending constraint translation and asset eligibility verification; these questions do not implement screening or account compliance checks.

### Clarifications and conflicting preferences

Clarifications reference the saved answer and narrow the missing detail. Range answers ask which endpoint to record explicitly, and variable-income answers ask about the missing savings buffer. Model follow-ups are checked against the current question and earlier questions, including repeated questions with an acknowledgment prefix; repeated output is replaced with a different contextual follow-up. Repeated unresolved uncertainty can move to another topic without inventing a value. Required unknowns still block confirmation.

Clarifications use a single AI badge above the follow-up. Conflicting preferences use a thin muted red accent, a short conflict label, and a compact neutral summary of the recorded facts. Longer explanations are collapsed under “Why we’re asking”; repeated banners and saved-answer warnings are omitted. The indicator works for button answers, free text, and model-generated conflicts. It clears when the preferences are reconciled; ordinary uncertainty keeps the neutral styling. A conflict is a reason to clarify a trade-off, not a rejected answer.
