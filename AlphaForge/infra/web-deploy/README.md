# AlphaForge 一键部署网站

从仓库根目录执行 `bash deploy_web.sh`，将 Next.js 网站部署到 ECS Fargate，并更新现有 AgentCore 后端，使网站登录用户可以调用优化器。不是静态导出，也不会启动一个公开的本地免登录服务。

## 默认无需域名：AWS HTTPS 地址

现在默认使用 AWS 分配的 `https://<distribution-id>.cloudfront.net` 地址。**不需要购买域名、Route 53 Hosted Zone 或自备 TLS 证书。** `config.example.json` 已省略三个自定义域名字段。

首次运行 `bash deploy_web.sh` 会生成 `config.json`。填写 AWS 账号并确认区域、Runtime ID 和 Memory ID，再次运行即可。新建 `AlphaForgePublic-Demo` Stack 包含 CloudFront、私有 ALB、网站服务、Cognito 和聊天存储；登录回调与 `APP_ORIGIN` 自动使用同一个 CloudFront 地址。部署完成后输出实际网址。

CloudFront 禁止缓存页面、API 和错误响应，转发用户 cookies、查询参数和请求头。默认只允许 HTTPS；ALB 位于私有子网，不直接暴露公网入口。网站任务仍在公有子网使用公网 IP 出站，并仅接受 ALB 入站，避免 NAT 网关。

长时间的优化请求使用 JSON 空白心跳维持 CloudFront 连接，不展示虚构模型输出；最终响应保留实际业务状态码。原来的 180 秒 AgentCore 调用上限不变。客户端断开时不会重新执行优化请求，仍可刷新查看已持久化结果。该模式只为部署容器设置 `WEB_STREAM_TURNS=1`，本地及自定义域名模式保持原响应方式。

若需要自定义域名，在配置中同时提供 `domainName`、`hostedZoneName`、`hostedZoneId`，仍使用原来的 Data/Web 两个 Stack。**两种模式的 Stack 布局不同；现有部署不要直接切换模式，需另行迁移用户和聊天数据。**

## 第一次准备

1. 使用长期有效的 AWS 账号；Workshop 临时账号通常不适合作为长期网站托管。
2. 安装 Python 3.10+、Node.js 24（最低 22）、AWS CLI v2 和 Docker Desktop，启动 Docker。脚本支持 macOS/Linux。
3. 在当前终端配置有效 AWS 凭证，执行 `aws sts get-caller-identity` 确认账号。不要把密钥放入配置文件。设置 `AWS_PROFILE` 或使用现有登录/临时环境变量均可。
4. 默认 AWS 地址模式无需域名。仅在选用自定义域名时，准备该账号下现有的 Route 53 公有 Hosted Zone，且域名 NS 已正确委派。脚本不购买域名、不修改注册商、不创建 Hosted Zone。
5. 确认现有 AgentCore Runtime、DEFAULT endpoint 为 READY，Memory 为 ACTIVE，模型和 Memory 权限已配置。当前脚本只复用同账号同区域的 HTTP/IAM Runtime 和短期 Memory。

如果使用此电脑已有的临时 Node 安装：

```bash
export PATH="/private/tmp/alphaforge-node/node-v24.22.3-darwin-arm64/bin:$PATH"
```

首次运行：

```bash
cd /Users/winston/Desktop/AlphaForge
bash deploy_web.sh
```

首次没有配置时会生成 `infra/web-deploy/config.json`，提示填写并退出，**不会部署**。也可手动复制 `config.example.json`。配置字段：

| 字段 | 填写内容 |
| --- | --- |
| account | 12 位 AWS 账号 ID，必须与当前登录账号一致 |
| region | 现有 Runtime 的区域，例如 us-east-1 |
| stackPrefix | 默认 AlphaForgePublic，上线后保持不变 |
| domainName | 可选；网站完整域名，例如 portfolio.your-company.com，不带 https:// |
| hostedZoneName | 可选；该域名所属的 Route 53 Zone 名称 |
| hostedZoneId | 可选；该公有 Zone 的 ID，以 Z 开头 |
| runtimeId | 现有 AgentCore Runtime ID；示例为当前项目的 ID |
| memoryId | 现有 Runtime 使用的 Memory ID |

配置文件没有 AWS 密钥或密码。不要把示例 Runtime ID 当成其他账号已存在的资源。

## 一键部署和更新

```bash
# 本地配置验证及 CloudFormation 合成：不调用 AWS、不构建 Docker
bash deploy_web.sh --check

# AWS 只读检查和变更预览：不创建资源、不更新后端
bash deploy_web.sh --plan

# 正式部署；以后更新代码仍执行同一条命令
bash deploy_web.sh
```

三种模式都会使用锁定版本安装部署依赖，因此需要 npm 网络访问。可以使用 `--config /absolute/path/config.json` 指定另一份配置。首次账号未 bootstrap 时，`--plan` 的 CDK diff 可能提示 bootstrap 缺失；正式部署会执行 bootstrap。

**正式命令无需再次确认，会创建收费资源，并把现有 AgentCore 的应用身份模式切换为 JWT 多用户。** 原来 `WEB_AUTH_MODE=local` 的本地客户端将不能再调用这个 Runtime；旧单用户聊天保留，但不会自动迁移到新用户。不要随后执行 `bedrock_portfolio/deploy_single_user.sh`，它会改回单用户模式，导致公开网站无法聊天。

脚本执行步骤：

1. 验证配置、AWS 账号、Runtime/endpoint、Memory 和 ECR。AWS 地址模式还检查可用区及 CloudFront 托管前缀列表；自定义域名模式检查 Hosted Zone。
2. 保存现有 Runtime 配置和可用于恢复的更新请求。
3. 在任何云资源变更前构建后端 ARM64 镜像，在无网络容器中实际运行优化器，确认 analytics 模块可用。
4. CDK bootstrap、显示 diff 并部署对应 Stack；CDK 构建网站镜像，创建 Fargate 服务、ALB 和 HTTPS 入口。AWS 地址模式通过 CloudFront 提供入口；自定义域名模式配置 DNS 和证书。
5. 将已通过本地检查的后端镜像发布到**原 ECR 仓库**。
6. 保留 Runtime 原执行角色、网络、模型、Memory 和其他设置，只更新镜像和应用身份配置。IAM/SigV4 入站传输保持不变；用户 JWT 在应用内验证。
7. 等待新 Runtime 版本与 DEFAULT endpoint READY，核对实际镜像、身份环境变量、角色和网络配置，再检查网站 HTTPS `/api/live` 并输出网址及 User Pool ID。

不会发送用户邀请、调用 AI 模型或购买域名。READY 代表基础设施和网页存活检查成功，不代表真实用户登录、模型访问和完整优化流程已经验证。

## 创建的资源

- 默认 `AlphaForgePublic-Demo`：包含下述身份、数据、网络及网站资源，加上 CloudFront Distribution 和 VPC Origin；Stack 启用删除保护。无 Route 53 或 ACM 资源。
- 自定义域名模式 `AlphaForgePublic-Data`：Cognito 用户池、服务端 OAuth 客户端、托管登录界面、会话密钥与客户端密钥、DynamoDB 聊天表。启用 Stack 删除保护；数据资源采用 Retain，用户池/聊天表启用删除保护，聊天表启用 PITR 和 TTL。
- 自定义域名模式 `AlphaForgePublic-Web`：两可用区 VPC、公有子网、ALB、证书、域名记录、一个 ARM64 Fargate 任务、日志和权限。任务使用公网 IP 出站，避免 NAT 网关；安全组仅允许 ALB 访问任务端口。
- CDK bootstrap：部署所需的资产 ECR/S3 和 IAM 角色；网站镜像由 CDK 管理。

网站 Task Role 只能访问应用表、指定 Runtime/DEFAULT endpoint 和 Memory 状态。Memory 事件读写权限继续留在原 AgentCore 执行角色。OAuth 密钥和会话加密密钥由 Secrets Manager 注入容器，不进入浏览器、配置文件或镜像。前端构建上下文排除 `.env*` 和 `.data`。

默认部署 1 个任务，适合初始小规模使用；滚动更新期间可以同时运行新旧任务。ALB 等待上限 300 秒，应用 AgentCore 调用上限仍为 180 秒。CloudFront origin 等待每个响应数据包的上限为 60 秒，优化接口每 15 秒发送空白心跳。当前没有自动扩容、WAF 或每用户调用配额；扩大公开使用前应按实际流量补充。仅受邀请用户可以登录，必须设置 TOTP MFA。

持续费用包括 CloudFront（AWS 地址模式）、Fargate、ALB、公网 IPv4、Cognito、Secrets Manager、DynamoDB、ECR/S3、日志、域名/DNS及 AgentCore/模型调用。脚本不会在没有流量时自动停止这些资源，具体费用取决于账号区域和使用量。

## 上线后验证

1. 到 Cognito 控制台找到脚本输出的 User Pool，为需要访问的用户创建账号并发送邀请（由你操作）。用户通过托管登录完成密码修改和 MFA 设置。
2. 访问输出的 HTTPS 网址，登录后检查连接状态。
3. 新建对话，完成一次真实优化，确认指标、非零资产列表和图表正常。真实调用会产生模型费用。
4. 用第二个用户确认不能读取第一个用户的聊天记录；刷新网页检查会话持久性。

## 故障与恢复

每次部署快照位于 `infra/web-deploy/runs/<时间戳>/`。目录权限受 umask 077 限制，包含 Runtime 配置，不要公开上传。

- 账号错误、临时凭证过期或 Docker 未启动：修复对应问题后重试。
- 证书长期验证中：自定义域名模式下检查 Route 53 Zone 和注册商 NS 委派；脚本不代改注册商。
- CloudFormation/ECS 失败：检查 Stack events 和 `/ecs` 对应日志；CDK 使用标准 CloudFormation 部署和 ECS circuit breaker，未使用 hotswap。
- Runtime 更新失败/超时：先查看保存的 `runtime-after.json`、`endpoint-after.json` 及 AWS 状态。脚本不会盲目回滚 AgentCore；网页资源可能已成功部署，避免假定所有步骤都被撤销。
- 需要恢复原后端：先确认没有正在进行的更新，再用对应快照运行以下命令。恢复只影响 AgentCore；若恢复为单用户模式，公开网站将不能聊天。

```bash
aws bedrock-agentcore-control update-agent-runtime --region YOUR_REGION \
  --cli-input-json file://infra/web-deploy/runs/YOUR_RUN/runtime-rollback.json
```

不要直接把 `runtime-before.json` 传给 update API，它包含只读字段。恢复后需再次检查 Runtime/endpoint READY。首次部署过程中若仅 Web Stack 失败，Data Stack 可能已创建并保留；再次部署使用相同配置即可更新，切勿随意改 stackPrefix。

本脚本不提供一键销毁聊天/用户数据。停止收费时应在控制台审查并移除 Web 资源；Data Stack、bootstrap 资产和旧 ECR 镜像仍需分别管理。

## 本地开发验证

```bash
cd infra/web-deploy
npm ci
npm test
python3 -m unittest discover -p 'test_*.py'
cd ../..
bash -n deploy_web.sh
npm --prefix web run typecheck
npm --prefix web run lint
```

基础设施测试在临时目录合成模板，不访问 AWS、不构建 Docker，涵盖 HTTPS、服务端密钥、身份隔离、持久化保护和构建上下文；Python 测试涵盖部署目标验证与现有 Runtime 配置保留。

### 部署权限与依赖审计

部署身份需要创建/更新上述 CloudFormation、IAM、ECS、EC2/VPC、ELB、ECR、Cognito、Secrets Manager、DynamoDB 和 Logs，以及默认模式的 CloudFront/VPC Origin（或自定义域名模式的 Route 53、ACM） 资源，以及读取/更新现有 AgentCore。首次 CDK bootstrap 通常需要接近管理员的权限；仅有模型调用权限不足以运行部署。运行中的网站只使用较小范围的 Task Role，不沿用部署者权限。

当前锁定的 CDK 2.277.0 依赖审计报告两项中等级别告警（同一个间接 minimatch glob 模式拒绝服务问题，包含父依赖计数）。它位于本地基础设施构建工具中，不打入网站或后端镜像；本项目使用固定的构建排除规则，不接受用户提供的 glob。没有采用 npm 建议的强制 CDK 降级。升级 CDK 后应重新执行 `npm audit`、模板测试和合成检查。


### 不知道账号 ID、域名和 Hosted Zone 在哪里？

- **AWS 账号 ID**：AWS 控制台右上角账号菜单显示 12 位 Account ID；也可运行 `aws sts get-caller-identity --query Account --output text`。[AWS 官方说明](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-identifiers.html)
- **网站域名**：例如 `portfolio.your-company.com`。需要你们拥有 `your-company.com`，或由公司域名管理员授权使用子域名。AWS 账号本身不附送自定义域名。
- **Hosted Zone ID**：在 Route 53 控制台的 Hosted zones 中选择该域名，查看 Hosted zone details 中的 ID。没有 Hosted Zone 时这里为空。
- 若确实需要购买自定义域名，可以使用 Route 53 的 Registered domains → Register domains；购买会产生费用，并自动创建该域名的 Hosted Zone。[AWS 官方说明](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/domain-register.html)

当前脚本默认使用 AWS 提供的 HTTPS 地址，省略全部三个域名字段即可。不要填入随意编造的域名、Zone ID 或 ALB 的 HTTP 地址。

默认 AWS 地址模式的可用区检查会排除 AWS 文档列出的 VPC Origin 不支持的 AZ ID。CloudFront VPC Origin 的创建可能需要数分钟；部署身份还需 ec2:DescribeAvailabilityZones、ec2:DescribeManagedPrefixLists 和创建 CloudFront 服务关联角色的权限。该模式依然是收费托管，并不是免费部署。
