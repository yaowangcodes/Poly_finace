import fs from 'node:fs';
export function validateConfig(c) {
  const required = ['account', 'region', 'stackPrefix', 'runtimeId', 'memoryId'];
  const fields = [...required, 'domainName', 'hostedZoneName', 'hostedZoneId'];
  if (!c || typeof c !== 'object' || required.some(k => typeof c[k] !== 'string' || !c[k])) throw new Error('Complete every field in config.json.');
  if (Object.keys(c).some(k => !fields.includes(k))) throw new Error('Unknown configuration field.');
  if (!/^\d{12}$/.test(c.account)) throw new Error('account must be your 12-digit AWS account ID.');
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(c.region)) throw new Error('Use a commercial AWS region, for example us-east-1.');
  if (!/^[A-Za-z][A-Za-z0-9-]{0,39}$/.test(c.stackPrefix)) throw new Error('Invalid stackPrefix.');
  if (`${c.stackPrefix.toLowerCase()}-${c.account}-${c.region}`.length > 63) throw new Error('Shorten stackPrefix so the Cognito domain prefix fits in 63 characters.');
  if (['domainName', 'hostedZoneName', 'hostedZoneId'].some(k => c[k] !== undefined)) {
    if (['domainName', 'hostedZoneName', 'hostedZoneId'].some(k => typeof c[k] !== 'string' || !c[k])) throw new Error('Provide all three custom-domain fields or omit all three for an AWS HTTPS address.');
  for (const key of ['domainName', 'hostedZoneName']) {
    if (c[key].length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(c[key]) || c[key].endsWith('example.com')) throw new Error(`Set a real ${key}, without https:// or a trailing dot.`);
  }
  if (c.domainName !== c.hostedZoneName && !c.domainName.endsWith('.' + c.hostedZoneName)) throw new Error('domainName must belong to hostedZoneName.');
  if (!/^Z[A-Z0-9]+$/.test(c.hostedZoneId)) throw new Error('Invalid Route 53 hostedZoneId.');
  }
  for (const key of ['runtimeId', 'memoryId']) if (!/^[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9]+$/.test(c[key])) throw new Error(`Invalid ${key}.`);
  return c;
}
export function readConfig() {
  return validateConfig(JSON.parse(fs.readFileSync(process.env.ALPHAFORGE_DEPLOY_CONFIG || new URL('./config.json', import.meta.url), 'utf8')));
}
