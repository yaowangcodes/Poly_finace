import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stack, Duration, RemovalPolicy, CfnOutput, CfnParameter, IgnoreMode, Fn,
  aws_cognito as cognito, aws_dynamodb as dynamodb, aws_secretsmanager as secretsmanager,
  aws_ec2 as ec2, aws_ecs as ecs, aws_ecs_patterns as patterns, aws_ecr_assets as assets,
  aws_iam as iam, aws_route53 as route53, aws_certificatemanager as acm,
  aws_logs as logs, aws_cloudfront as cloudfront, aws_cloudfront_origins as origins,
  aws_elasticloadbalancingv2 as elbv2 } from 'aws-cdk-lib';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Resolve zones in CloudFormation, so local synthesis never requires AWS credentials.
class RegionalStack extends Stack {
  get availabilityZones() { if (process.env.ALPHAFORGE_DEPLOY_AZS) return JSON.parse(process.env.ALPHAFORGE_DEPLOY_AZS); return [Fn.select(0, Fn.getAzs(this.region)), Fn.select(1, Fn.getAzs(this.region))]; }
}
export function createStacks(app, c) {
  app.node.setContext('@aws-cdk/core:defaultCrossStackReferences', 'strong');
  const env = { account: c.account, region: c.region };
  const demo = !c.domainName;
  const data = demo ? new RegionalStack(app, `${c.stackPrefix}-Demo`, { env, terminationProtection: true })
    : new Stack(app, `${c.stackPrefix}-Data`, { env, terminationProtection: true });
  let demoVpc, demoAlb, demoListener, distribution;
  if (demo) {
    demoVpc = new ec2.Vpc(data, 'Vpc', { maxAzs: 2, natGateways: 0, subnetConfiguration: [
      { name: 'Public', subnetType: ec2.SubnetType.PUBLIC },
      { name: 'Origin', subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
    ] });
    demoAlb = new elbv2.ApplicationLoadBalancer(data, 'LoadBalancer', { vpc: demoVpc,
      internetFacing: false, vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED } });
    demoAlb.setAttribute('idle_timeout.timeout_seconds', '300');
    demoListener = demoAlb.addListener('Http', { port: 80, open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403) });
    // AWS-managed CloudFront origin-facing prefix list; resolved by deployment preflight.
    const prefixList = new CfnParameter(data, 'CloudFrontPrefixListId', { type: 'String', allowedPattern: 'pl-[a-f0-9]+' });
    demoAlb.connections.allowFrom(ec2.Peer.prefixList(prefixList.valueAsString), ec2.Port.tcp(80));
    const privateOrigin = origins.VpcOrigin.withApplicationLoadBalancer(demoAlb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: Duration.seconds(60), connectionAttempts: 1,
    });
    distribution = new cloudfront.Distribution(data, 'Distribution', {
      defaultBehavior: { origin: privateOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: false,
      },
      errorResponses: [400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504].map(httpStatus => ({ httpStatus, ttl: Duration.seconds(0) })),
    });
    distribution.node.addDependency(demoListener);
    distribution.node.addDependency(demoVpc.internetConnectivityEstablished);
  }
  const pool = new cognito.UserPool(data, 'Users', {
    selfSignUpEnabled: false, signInAliases: { email: true }, autoVerify: { email: true },
    standardAttributes: { email: { required: true, mutable: true } },
    passwordPolicy: { minLength: 12, requireLowercase: true, requireUppercase: true, requireDigits: true, requireSymbols: true },
    mfa: cognito.Mfa.REQUIRED, mfaSecondFactor: { sms: false, otp: true },
    accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    featurePlan: cognito.FeaturePlan.ESSENTIALS,
    deletionProtection: true, removalPolicy: RemovalPolicy.RETAIN,
  });
  const origin = demo ? `https://${distribution.distributionDomainName}` : `https://${c.domainName}`;
  const client = pool.addClient('WebClient', {
    generateSecret: true, preventUserExistenceErrors: true, enableTokenRevocation: true,
    oAuth: { flows: { authorizationCodeGrant: true }, scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
      callbackUrls: [`${origin}/api/auth/callback`], logoutUrls: [origin] },
    supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    idTokenValidity: Duration.hours(1), accessTokenValidity: Duration.hours(1),
  });
  const domain = pool.addDomain('Login', {
    cognitoDomain: { domainPrefix: `${c.stackPrefix.toLowerCase()}-${c.account}-${c.region}` },
    managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
  });
  const branding = new cognito.CfnManagedLoginBranding(data, 'LoginBranding', {
    userPoolId: pool.userPoolId, clientId: client.userPoolClientId, useCognitoProvidedValues: true,
  });
  branding.node.addDependency(domain);
  const clientSecret = new secretsmanager.Secret(data, 'OidcClientSecret', {
    secretStringValue: client.userPoolClientSecret, removalPolicy: RemovalPolicy.RETAIN,
  });
  // 43 base64-alphabet characters decode to 32 bytes; generated only by Secrets Manager.
  const sessionSecret = new secretsmanager.Secret(data, 'SessionKey', {
    generateSecretString: { passwordLength: 43, excludePunctuation: true, includeSpace: false },
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const table = new dynamodb.Table(data, 'Conversations', {
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, timeToLiveAttribute: 'ttl',
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    deletionProtection: true, removalPolicy: RemovalPolicy.RETAIN,
  });
  const issuer = `https://cognito-idp.${c.region}.amazonaws.com/${pool.userPoolId}`;
  for (const [name, value] of Object.entries({ UserPoolId: pool.userPoolId, AuthIssuer: issuer,
    AuthAudience: client.userPoolClientId, AuthJwksUrl: `${issuer}/.well-known/jwks.json` })) new CfnOutput(data, name, { value });

  const web = demo ? data : new RegionalStack(app, `${c.stackPrefix}-Web`, { env });
  const vpc = demoVpc ?? new ec2.Vpc(web, 'Vpc', { maxAzs: 2, natGateways: 0,
    subnetConfiguration: [{ name: 'Public', subnetType: ec2.SubnetType.PUBLIC }] });
  const zone = demo ? undefined : route53.HostedZone.fromHostedZoneAttributes(web, 'Zone', {
    hostedZoneId: c.hostedZoneId, zoneName: c.hostedZoneName,
  });
  const certificate = demo ? undefined : new acm.Certificate(web, 'Certificate', {
    domainName: c.domainName, validation: acm.CertificateValidation.fromDns(zone),
  });
  const cluster = new ecs.Cluster(web, 'Cluster', { vpc });
  const logGroup = new logs.LogGroup(web, 'WebLogs', { retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: RemovalPolicy.RETAIN });
  const runtimeArn = `arn:aws:bedrock-agentcore:${c.region}:${c.account}:runtime/${c.runtimeId}`;
  const taskImageOptions = {
      image: ecs.ContainerImage.fromAsset(path.join(root, 'web'), {
        platform: assets.Platform.LINUX_ARM64, ignoreMode: IgnoreMode.DOCKER,
        exclude: ['node_modules', '.next', '.env*', '.data', 'coverage', 'cdk.out'],
      }), containerPort: 3000,
      environment: { ...(demo ? { WEB_STREAM_TURNS: '1' } : {}), NODE_ENV: 'production', WEB_AUTH_MODE: 'oidc', APP_ORIGIN: origin,
        STORE_DRIVER: 'dynamodb', ALLOW_LOCAL_FILE_STORE: 'false', DYNAMODB_TABLE: table.tableName,
        AWS_REGION: c.region, AGENTCORE_RUNTIME_ARN: runtimeArn, AGENTCORE_QUALIFIER: 'DEFAULT',
        AUTH_ISSUER: issuer, AUTH_AUDIENCE: client.userPoolClientId,
        AUTH_JWKS_URL: `${issuer}/.well-known/jwks.json`, OIDC_CLIENT_ID: client.userPoolClientId },
      secrets: { OIDC_CLIENT_SECRET: ecs.Secret.fromSecretsManager(clientSecret),
        SESSION_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(sessionSecret) },
      logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup }),
    };
  let service;
  if (demo) {
    const taskDefinition = new ecs.FargateTaskDefinition(web, 'TaskDefinition', {
      cpu: 512, memoryLimitMiB: 1024,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
    });
    const { containerPort, logDriver, ...containerOptions } = taskImageOptions;
    taskDefinition.addContainer('web', { ...containerOptions, logging: logDriver,
      portMappings: [{ containerPort }] });
    const tasks = new ecs.FargateService(web, 'Website', { cluster, taskDefinition, desiredCount: 1,
      minHealthyPercent: 100, assignPublicIp: true, vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      healthCheckGracePeriod: Duration.seconds(120), circuitBreaker: { rollback: true } });
    const targetGroup = new elbv2.ApplicationTargetGroup(web, 'TargetGroup', {
      vpc, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targets: [tasks],
      targetType: elbv2.TargetType.IP,
    });
    const rule = new elbv2.ApplicationListenerRule(web, 'WebsiteRouting', {
      listener: demoListener, priority: 1,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])], targetGroups: [targetGroup],
    });
    tasks.node.addDependency(rule);
    tasks.connections.allowFrom(demoAlb, ec2.Port.tcp(3000));
    service = { taskDefinition, service: tasks, targetGroup };
  } else {
    service = new patterns.ApplicationLoadBalancedFargateService(web, 'Website', {
      cluster, cpu: 512, memoryLimitMiB: 1024, desiredCount: 1, minHealthyPercent: 100,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      assignPublicIp: true, taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publicLoadBalancer: true, certificate, domainName: c.domainName, domainZone: zone,
      redirectHTTP: true, idleTimeout: Duration.seconds(300),
      healthCheckGracePeriod: Duration.seconds(120), circuitBreaker: { rollback: true }, taskImageOptions,
    });
  }
  // Task ingress is opened only from the ALB by the ECS pattern, never from the internet.
  service.targetGroup.configureHealthCheck({ path: '/api/live', healthyHttpCodes: '200' });
  service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '240');
  table.grant(service.taskDefinition.taskRole, 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:Query');
  service.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
    actions: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:GetAgentRuntime', 'bedrock-agentcore:GetAgentRuntimeEndpoint'],
    resources: [runtimeArn, `${runtimeArn}/runtime-endpoint/DEFAULT`],
  }));
  service.taskDefinition.addToTaskRolePolicy(new iam.PolicyStatement({
    actions: ['bedrock-agentcore:GetMemory'], resources: [`arn:aws:bedrock-agentcore:${c.region}:${c.account}:memory/${c.memoryId}`],
  }));
  for (const [name, value] of Object.entries({ WebsiteUrl: origin, ClusterName: cluster.clusterName,
    ServiceName: service.service.serviceName })) new CfnOutput(web, name, { value });
  return { data, web };
}
