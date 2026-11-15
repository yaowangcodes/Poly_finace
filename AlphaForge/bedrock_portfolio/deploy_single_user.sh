#!/usr/bin/env bash
# Run from the terminal containing your Workshop credentials. Never use bash -x.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION="$AWS_REGION"
export AWS_PAGER=""
export AWS_ACCOUNT_ID=339712771896
export AGENT_RUNTIME_ID=AlphaForgePortfolio-TevjcpB3OT
export AGENTCORE_MEMORY_ID=AlphaForgeConversationSTM-j2yxFXBeaQ
export AUTH_MODE=iam_single_user
export SINGLE_USER_ACTOR_ID=alphaforge-local-owner
PYTHON=.venv/bin/python
[[ -x "$PYTHON" ]] || { echo 'Missing .venv/bin/python'; exit 1; }
command -v aws >/dev/null
command -v docker >/dev/null
echo 'Checking AWS identity (no credentials are printed).'
account=$(aws sts get-caller-identity --query Account --output text)
[[ "$account" == "$AWS_ACCOUNT_ID" ]] || { echo 'Wrong AWS account. No changes made.'; exit 1; }
docker buildx version >/dev/null
docker info >/dev/null
run_id=$(date -u +%Y%m%dT%H%M%SZ)-$$
export DEPLOY_DIR="bedrock_portfolio/deployments/$run_id"
mkdir -p "$DEPLOY_DIR"
trap 'echo "Deployment stopped. Review artifacts in $DEPLOY_DIR before retrying; no automatic rollback was performed." >&2' ERR

echo 'Reading existing Runtime, endpoint, Memory and ECR configuration.'
aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --output json > "$DEPLOY_DIR/runtime-before.json"
aws bedrock-agentcore-control get-agent-runtime-endpoint --agent-runtime-id "$AGENT_RUNTIME_ID" --endpoint-name DEFAULT --output json > "$DEPLOY_DIR/endpoint-before.json"
aws bedrock-agentcore-control get-memory --memory-id "$AGENTCORE_MEMORY_ID" --output json > "$DEPLOY_DIR/memory.json"
aws ecr describe-repositories --repository-names alphaforge-portfolio --output json > "$DEPLOY_DIR/repository.json"
export IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/alphaforge-portfolio:stm-${run_id}"
"$PYTHON" - <<'PY'
import json, os, sys
from pathlib import Path
from string import Template
sys.path.insert(0, 'bedrock_portfolio')
from prepare_runtime_update import build_update
p = Path(os.environ['DEPLOY_DIR'])
c = json.loads((p/'runtime-before.json').read_text())
e = json.loads((p/'endpoint-before.json').read_text())
m = json.loads((p/'memory.json').read_text())['memory']
assert c['status'] == 'READY' and e['status'] == 'READY', 'Existing Runtime/endpoint must be READY'
assert str(e['liveVersion']) == str(c['agentRuntimeVersion']), 'Endpoint differs from latest version; inspect before updating'
assert m['status'] == 'ACTIVE', 'Existing Memory must be ACTIVE'
assert not m.get('strategies'), 'Expected STM-only Memory; inspect strategies before deploying'
assert c.get('protocolConfiguration', {}).get('serverProtocol') == 'HTTP', 'Expected existing HTTP Runtime'
expected = '339712771896.dkr.ecr.us-east-1.amazonaws.com/alphaforge-portfolio'
assert c['agentRuntimeArtifact']['containerConfiguration']['containerUri'].split('@')[0].split(':')[0] == expected, 'Unexpected image repository'
assert c['roleArn'].startswith('arn:aws:iam::339712771896:role/'), 'Unexpected execution role account'
(p/'role-name.txt').write_text(c['roleArn'].rsplit('/', 1)[1])
(p/'runtime-update.json').write_text(json.dumps(build_update(c, os.environ), indent=2)+'\n')
template = Path('bedrock_portfolio/memory-policy.template.json').read_text()
(p/'memory-policy.json').write_text(json.dumps(json.loads(Template(template).substitute(os.environ)), indent=2)+'\n')
PY
role_name=$(cat "$DEPLOY_DIR/role-name.txt")
aws iam get-role --role-name "$role_name" --output json > "$DEPLOY_DIR/role-before.json"
aws iam list-role-policies --role-name "$role_name" --output json > "$DEPLOY_DIR/inline-policies-before.json"
aws iam list-attached-role-policies --role-name "$role_name" --output json > "$DEPLOY_DIR/attached-policies-before.json"
# A unique, narrowly scoped policy avoids replacing any existing policy.
policy_name="AlphaForgeSTM-${run_id}"
echo 'Building the existing HTTP container for linux/arm64.'
docker buildx build --platform linux/arm64 --provenance=false --load -f bedrock_portfolio/Dockerfile -t "$IMAGE_URI" .
echo 'Uploading the new image to the existing ECR repository.'
aws ecr get-login-password | docker login --username AWS --password-stdin "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
docker push "$IMAGE_URI"
echo 'Adding Memory permissions to the existing execution role.'
aws iam put-role-policy --role-name "$role_name" --policy-name "$policy_name" --policy-document "file://$DEPLOY_DIR/memory-policy.json"
printf '%s\n' "$policy_name" > "$DEPLOY_DIR/added-policy-name.txt"
echo 'Updating the existing Runtime; no model invocation will be made.'
aws bedrock-agentcore-control update-agent-runtime --cli-input-json "file://$DEPLOY_DIR/runtime-update.json" --output json > "$DEPLOY_DIR/runtime-updated.json"
target_version=$("$PYTHON" -c 'import json,os; print(json.load(open(os.environ["DEPLOY_DIR"]+"/runtime-updated.json"))["agentRuntimeVersion"])')
for attempt in {1..60}; do
  aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id "$AGENT_RUNTIME_ID" --agent-runtime-version "$target_version" --output json > "$DEPLOY_DIR/runtime-after.json"
  aws bedrock-agentcore-control get-agent-runtime-endpoint --agent-runtime-id "$AGENT_RUNTIME_ID" --endpoint-name DEFAULT --output json > "$DEPLOY_DIR/endpoint-after.json"
  state=$("$PYTHON" - "$target_version" <<'PY'
import json, os, sys
from pathlib import Path
p=Path(os.environ['DEPLOY_DIR'])
r=json.loads((p/'runtime-after.json').read_text())
e=json.loads((p/'endpoint-after.json').read_text())
if r['status'] in ('CREATE_FAILED','UPDATE_FAILED') or e['status'] in ('CREATE_FAILED','UPDATE_FAILED'):
    print('FAILED')
elif r['status']=='READY' and e['status']=='READY' and str(e.get('liveVersion'))==sys.argv[1]:
    print('READY')
else:
    print('WAITING')
PY
)
  [[ "$state" != FAILED ]] || { echo 'AWS reports deployment failure. Inspect saved status files.'; exit 1; }
  if [[ "$state" == READY ]]; then
    echo "Deployment READY, Runtime version $target_version. Artifacts: $DEPLOY_DIR"
    echo 'No model test was run. Refresh UI connection status, then explicitly create a new conversation.'
    exit 0
  fi
  echo "Waiting for Runtime version $target_version and DEFAULT endpoint ($attempt/60)."
  sleep 10
done
echo "Readiness timed out. Inspect $DEPLOY_DIR; do not blindly rerun the update."
exit 1
