import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { validateConfig } from './config.mjs';
import { createStacks } from './stacks.mjs';
const config = { account: '123456789012', region: 'us-east-1', stackPrefix: 'AlphaForgeTest',
  domainName: 'portfolio.test.org', hostedZoneName: 'test.org', hostedZoneId: 'Z123TEST',
  runtimeId: 'AlphaForgePortfolio-TevjcpB3OT', memoryId: 'AlphaForgeConversationSTM-j2yxFXBeaQ' };

test('reject placeholders and mismatched domains before any AWS call', () => {
  assert.deepEqual(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, account: 'REPLACE_ME' }));
  assert.throws(() => validateConfig({ ...config, domainName: 'another.org' }));
  assert.throws(() => validateConfig({ ...config, hostedZoneId: 'REPLACE_ME' }));
  assert.throws(() => validateConfig({ ...config, stackPrefix: 'A'.repeat(40), region: 'ap-southeast-1' }));
});

test('synthesized infrastructure preserves identity, secrets, IAM isolation and HTTPS', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'alphaforge-cdk-'));
  try {
    const app = new App({ outdir: output });
    const { data, web } = createStacks(app, config);
    const d = Template.fromStack(data), w = Template.fromStack(web);
    d.hasResourceProperties('AWS::DynamoDB::Table', { DeletionProtectionEnabled: true,
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true } });
    d.hasResourceProperties('AWS::Cognito::UserPool', { AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, MfaConfiguration: 'ON' });
    d.hasResourceProperties('AWS::Cognito::UserPoolClient', { GenerateSecret: true, AllowedOAuthFlows: ['code'],
      CallbackURLs: ['https://portfolio.test.org/api/auth/callback'] });
    d.hasResourceProperties('AWS::Cognito::ManagedLoginBranding', { UseCognitoProvidedValues: true });
    d.hasResourceProperties('AWS::SecretsManager::Secret', { GenerateSecretString: { PasswordLength: 43, ExcludePunctuation: true, IncludeSpace: false } });
    w.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', { Protocol: 'HTTPS', Port: 443 });
    w.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { HealthCheckPath: '/api/live' });
    w.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RuntimePlatform: { CpuArchitecture: 'ARM64', OperatingSystemFamily: 'LINUX' },
      ContainerDefinitions: Match.arrayWith([Match.objectLike({
        Secrets: Match.arrayWith([Match.objectLike({ Name: 'OIDC_CLIENT_SECRET' }), Match.objectLike({ Name: 'SESSION_ENCRYPTION_KEY' })]),
        Environment: Match.arrayWith([{ Name: 'WEB_AUTH_MODE', Value: 'oidc' }, { Name: 'ALLOW_LOCAL_FILE_STORE', Value: 'false' }]),
      })]),
    });
    w.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
      Action: ['bedrock-agentcore:InvokeAgentRuntime', 'bedrock-agentcore:GetAgentRuntime', 'bedrock-agentcore:GetAgentRuntimeEndpoint'],
      Resource: Match.arrayWith([`arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/${config.runtimeId}`]),
    })]) } });
    // Synth is offline: imported hosted zone avoids AWS context lookups; no Docker build.
    const assembly = app.synth();
    assert.equal(assembly.stacks.length, 2);
    assert.equal((assembly.manifest.missing || []).length, 0);
    assert.equal(assembly.getStackByName(data.stackName).terminationProtection, true);
    for (const resource of Object.values(w.findResources('AWS::EC2::SecurityGroup'))) {
      for (const ingress of resource.Properties.SecurityGroupIngress || []) {
        assert.ok(!(ingress.FromPort === 3000 && ingress.CidrIp === '0.0.0.0/0'));
      }
    }
    // Asset staging must exclude local secrets and the saved user conversations.
    for (const item of fs.readdirSync(output).filter(name => name.startsWith('asset.'))) {
      const dir = path.join(output, item);
      if (fs.statSync(dir).isDirectory()) {
        assert.equal(fs.existsSync(path.join(dir, '.env.local')), false);
        assert.equal(fs.existsSync(path.join(dir, '.data')), false);
      }
    }
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test('AWS address mode needs no domain and has a private uncached CloudFront origin', () => {
  const demo = { ...config };
  for (const key of ['domainName', 'hostedZoneName', 'hostedZoneId']) delete demo[key];
  assert.deepEqual(validateConfig(demo), demo);
  assert.throws(() => validateConfig({ ...demo, domainName: 'portfolio.test.org' }));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'alphaforge-demo-cdk-'));
  try {
    const app = new App({ outdir: output });
    const { data, web } = createStacks(app, demo);
    assert.equal(data, web);
    const t = Template.fromStack(web);
    t.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    t.resourceCountIs('AWS::Route53::RecordSet', 0);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    t.hasResourceProperties('AWS::CloudFront::VpcOrigin', { VpcOriginEndpointConfig: Match.objectLike({ OriginProtocolPolicy: 'http-only' }) });
    t.hasResourceProperties('AWS::CloudFront::Distribution', { DistributionConfig: Match.objectLike({
      DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https',
        CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', Compress: false }),
      Origins: Match.arrayWith([Match.objectLike({ ConnectionAttempts: 1, VpcOriginConfig: Match.objectLike({ OriginReadTimeout: 60 }) })]),
    }) });
    t.hasResourceProperties('AWS::ECS::TaskDefinition', { ContainerDefinitions: Match.arrayWith([
      Match.objectLike({ Environment: Match.arrayWith([{ Name: 'WEB_STREAM_TURNS', Value: '1' }]) }),
    ]) });
    const assembly = app.synth();
    assert.equal(assembly.stacks.length, 1);
    assert.equal((assembly.manifest.missing || []).length, 0);
    const template = t.toJSON();
    const client = Object.values(template.Resources).find(r => r.Type === 'AWS::Cognito::UserPoolClient');
    const callback = JSON.stringify(client.Properties.CallbackURLs);
    assert.match(callback, /Distribution/);
    assert.match(callback, /api\/auth\/callback/);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
