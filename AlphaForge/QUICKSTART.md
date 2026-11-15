# AlphaForge Local Quick Start

## 1. Sign in to AWS Workshop Studio

Open your [Workshop dashboard](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/fr-FR) and sign in using your event access.

Under **AWS account access**, select **Get AWS CLI credentials**. Copy the macOS/Linux export commands and paste them into your terminal. They set:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_SESSION_TOKEN`

Keep credentials private. Do not put them in source code, Git, or chat messages. Signing in through the browser alone does not authenticate your local terminal.

## 2. Verify the AWS connection

In the same terminal:

```bash
export AWS_REGION=us-east-1
aws sts get-caller-identity
```

The returned `Account` must be **339712771896** for this deployment. If it differs, stop and check the Workshop account.

## 3. Deploy the updated agent once

Skip this step if the updated agent has already been deployed successfully. Docker Desktop must be running. This step changes AWS resources and may incur charges.

```bash
cd /Users/winston/Desktop/AlphaForge
bash bedrock_portfolio/deploy_single_user.sh
```

Wait for **Deployment READY**. The script updates the existing Runtime and Memory permissions; it does not invoke the model. If it fails, inspect the error and saved deployment files before rerunning it.

## 4. Start the UI

Use the **same terminal** that holds your Workshop credentials:

```bash
cd /Users/winston/Desktop/AlphaForge
export PATH="/private/tmp/alphaforge-node/node-v24.22.3-darwin-arm64/bin:$PATH"
export AWS_REGION=us-east-1
npm --prefix web run dev
```

Open **http://localhost:3000**. Keep the terminal running; press `Ctrl+C` to stop.

The PATH line uses the temporary Node.js installation already prepared on this Mac. If it no longer exists, install Node.js 24 and omit that line. Project dependencies are already installed.

Local single-user mode needs no website sign-in. Next.js reads AWS credentials from its terminal environment. After deployment, refresh the connection status and explicitly start a new chat. Real chat requests incur normal AWS charges.

## Local configuration

`web/.env.local` is already configured. Keep these values:

```ini
APP_ORIGIN=http://localhost:3000
WEB_AUTH_MODE=local
LOCAL_OWNER_ID=alphaforge-local-owner
AWS_REGION=us-east-1
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:339712771896:runtime/AlphaForgePortfolio-TevjcpB3OT
AGENTCORE_QUALIFIER=DEFAULT
STORE_DRIVER=file
ALLOW_LOCAL_FILE_STORE=true
DATA_DIR=.data
```

No `AWS_PROFILE` is needed when using Workshop credential exports. Preserve `web/.data` and `LOCAL_OWNER_ID` to retain access to saved chats. Keep this single-user server on localhost.

## Troubleshooting

| Problem | Action |
| --- | --- |
| AWS credentials expired | Get fresh credentials from the Workshop dashboard, export all three values, and restart the UI in that terminal. |
| Disconnected | Read the connection message and click **Retry connection**. The check does not invoke a model. |
| Runtime not ready or Memory not configured | Complete the one-time deployment above and wait for READY. |
| Conversation needs review | Refresh status. If it remains uncertain, fix the connection/deployment first, then explicitly start a new chat and reconfirm all limits. Do not retry the uncertain turn. |
| Port 3000 already in use | Stop the old development server with `Ctrl+C`, then restart. |

**Ready** confirms configuration checks, not a completed end-to-end model test. Workshop access is temporary and subject to the event's expiry and permissions.

## 部署为公网网站

使用新的独立入口，详见 [一键部署说明](infra/web-deploy/README.md)：

```bash
bash deploy_web.sh
```

首次执行生成 `infra/web-deploy/config.json` 后退出。填入 AWS 账号、区域和现有 AgentCore/Memory 信息，再运行同一命令即可部署。默认输出 AWS 提供的 `https://….cloudfront.net` 网站地址，无需购买域名或配置 Route 53。需要 Node.js 24、Python 3、AWS CLI 凭证和运行中的 Docker Desktop。

- `bash deploy_web.sh --check`：本地配置及模板检查，不调用 AWS。
- `bash deploy_web.sh --plan`：AWS 只读检查和变更预览。
- `bash deploy_web.sh`：实际创建收费资源并更新后端，无二次确认。

**公网部署会把现有 AgentCore 切换为多用户 JWT 模式，原本地免登录模式将无法调用它。之后不要再运行上面的 `deploy_single_user.sh`，否则会切回单用户模式。** 公网网站默认仅受邀请用户可登录，部署完成后通过 Cognito 控制台添加用户。
