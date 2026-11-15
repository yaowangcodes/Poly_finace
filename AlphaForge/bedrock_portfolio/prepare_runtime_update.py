"""Generate an UpdateAgentRuntime request locally; never makes AWS calls."""
import json
import os
from pathlib import Path


def build_update(current, env):
    # Preserve the deployed runtime configuration instead of replacing its role,
    # networking, authorizer, existing environment, or optional settings.
    fields = ['agentRuntimeId', 'roleArn', 'networkConfiguration', 'description',
              'authorizerConfiguration', 'requestHeaderConfiguration',
              'protocolConfiguration', 'lifecycleConfiguration', 'hooksConfiguration',
              'metadataConfiguration', 'filesystemConfigurations',
              'capacityProviderConfiguration', 'platformVersion', 'allowedPorts',
              'resourceConfigurations']
    result = {key: current[key] for key in fields if key in current}
    for key in ['agentRuntimeId', 'roleArn']:
        if key not in result:
            raise ValueError(f'Missing {key} in get-agent-runtime response')
    result['agentRuntimeArtifact'] = {'containerConfiguration': {'containerUri': env['IMAGE_URI']}}
    result['environmentVariables'] = dict(current.get('environmentVariables', {}))
    mode = env.get('AUTH_MODE', 'jwt')
    if mode not in ('jwt', 'iam_single_user'):
        raise ValueError('AUTH_MODE must be jwt or iam_single_user')
    if mode == 'iam_single_user' and current.get('authorizerConfiguration'):
        raise ValueError('Single-user mode requires the existing IAM endpoint; do not silently change a JWT authorizer.')
    keys = ['AGENTCORE_MEMORY_ID']
    keys += ['SINGLE_USER_ACTOR_ID'] if mode == 'iam_single_user' else ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URL']
    for key in keys:
        result['environmentVariables'][key] = env[key]
    result['environmentVariables']['AUTH_MODE'] = mode
    if not result['environmentVariables'].get('BEDROCK_MODEL_ID'):
        raise ValueError('Deployed runtime has no BEDROCK_MODEL_ID')
    return result


def main():
    current = json.loads(Path('bedrock_portfolio/runtime-current.json').read_text())
    output = build_update(current, os.environ)
    Path('bedrock_portfolio/runtime-update.json').write_text(json.dumps(output, indent=2) + '\n')


if __name__ == '__main__':
    main()
