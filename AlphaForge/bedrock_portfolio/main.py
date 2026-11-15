"""One Strands agent and one local optimizer tool on AgentCore Runtime."""
import fcntl
import json
import uuid
import logging
import os
from pathlib import Path

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from strands import Agent, tool
from strands.models import BedrockModel

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from conversation import (ConversationError, StrictMemorySessionManager,
                          authenticated_actor, memory_session_id)

import portfolio_skill

app = BedrockAgentCoreApp()
INSTRUCTIONS = Path(__file__).with_name('AGENT_INSTRUCTIONS.md').read_text()


@tool
def portfolio_analysis(request_json: str) -> dict:
    """Run a read-only portfolio simulation using the packaged CSV snapshot.

    Args:
        request_json: JSON object encoded as a string. operation is list_profiles,
            indicators, or optimize. profile is Custom for explicit constraints,
            or a requested named preset. constraints maps supported keys to fractions
            (cash_min=0.20, crypto_max=0, vol_max=0.08). Optional as_of, kappa,
            shrink, previous_weights retain engine defaults. Call list_profiles
            to discover all profiles and supported constraint keys.

    Returns:
        Actual engine output with status ok, optimal, infeasible, invalid_input,
        or error. Never relax constraints or invent results on failure.
    """
    # The existing adapter calls parse_json() then run(), and sanitizes failures.
    return portfolio_skill.portfolio_analysis(request_json)


def create_agent(session_manager=None, state=None, tools=None):
    model = BedrockModel(
        model_id=os.environ['BEDROCK_MODEL_ID'],
        region_name=os.environ.get('AWS_REGION') or os.environ.get('AWS_DEFAULT_REGION'),
        max_tokens=4096, streaming=False,
    )
    return Agent(model=model, tools=[portfolio_analysis] if tools is None else tools,
                 agent_id='alphaforge', session_manager=session_manager,
                 state=state, system_prompt=INSTRUCTIONS, callback_handler=None)


def validate_patch(patch):
    if not isinstance(patch, dict) or set(patch) - set(portfolio_skill.LIMIT_MAX):
        raise portfolio_skill.InputError('Supply supported constraint keys only.')
    return {key: (None if value is None else portfolio_skill.number(
        value, key, portfolio_skill.LIMIT_MAX[key])) for key, value in patch.items()}


def merge_constraints(confirmed, patch):
    result = dict(confirmed)
    for key, value in validate_patch(patch).items():
        if value is None:
            result.pop(key, None)
        else:
            result[key] = value
    return result


def session_tools(record, results=None):
    @tool
    def propose_constraints(patch_json: str) -> dict:
        """Propose only changed limits for user review; null means remove a limit.

        Args:
            patch_json: JSON constraint patch. This does NOT confirm anything.
        """
        try:
            patch = validate_patch(json.loads(patch_json))
            record['pending'] = patch
            return {'status': 'confirmation_required', 'proposed_patch': patch,
                    'confirmed_constraints': record['confirmed']}
        except (ValueError, TypeError):
            return {'status': 'invalid_input', 'message': 'Invalid constraint patch.'}

    @tool(name='portfolio_analysis')
    def guarded_analysis(request_json: str) -> dict:
        """Run the existing portfolio_analysis using all confirmed session limits.

        Args:
            request_json: Existing portfolio tool JSON; discovery and indicators unchanged.
        """
        try:
            request = portfolio_skill.parse_json(request_json)
            checked = portfolio_skill.validate_request(request)
            if checked['operation'] == 'optimize':
                if record['pending'] is not None:
                    return {'status': 'confirmation_required', 'proposed_patch': record['pending']}
                confirmed = record['confirmed']
                if confirmed:
                    if any(key not in confirmed or value != confirmed[key]
                           for key, value in checked['constraints'].items()):
                        return {'status': 'confirmation_required',
                                'message': 'Propose changes first; confirmed limits cannot be overridden.'}
                    request.update(profile='Custom', constraints=dict(confirmed))
                elif checked['constraints']:
                    return {'status': 'confirmation_required', 'message': 'Propose and confirm explicit limits first.'}
            output = portfolio_skill.portfolio_analysis(json.dumps(request))
            if results is not None and checked['operation'] == 'optimize':
                results.append(output)
            return output
        except (ValueError, TypeError):
            return {'status': 'invalid_input', 'message': 'Invalid portfolio request.'}
    return [guarded_analysis, propose_constraints]


@app.entrypoint
def invoke(payload, context=None):
    allowed = {'prompt', 'identity_token', 'session_id', 'new_conversation',
               'revision', 'confirmed_constraints', 'confirm_proposal', 'reject_proposal'}
    if not isinstance(payload, dict) or set(payload) - allowed:
        return {'status': 'invalid_input', 'message': 'Unsupported request fields.'}
    prompt = payload.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000:
        return {'status': 'invalid_input', 'message': 'prompt must contain 1–16000 characters.'}
    try:
        session = str(uuid.UUID(payload['session_id']))
        if session != payload['session_id']:
            raise ValueError()
        new = payload.get('new_conversation', False)
        if any(type(value) is not bool for value in [new, payload.get('confirm_proposal', False), payload.get('reject_proposal', False)]):
            raise ValueError()
        if (new and 'revision' in payload) or (not new and not isinstance(payload.get('revision'), str)):
            raise ValueError()
        patch = validate_patch(payload.get('confirmed_constraints', {}))
        if (payload.get('confirm_proposal') and payload.get('reject_proposal')) or ((payload.get('confirm_proposal') or payload.get('reject_proposal')) and 'confirmed_constraints' in payload):
            raise ValueError()
        if context is not None and context.session_id != session:
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError):
        return {'status': 'invalid_input', 'message': 'Use a UUID session_id matching runtimeSessionId; new_conversation=true for a new UUID, otherwise supply the last revision.'}
    try:
        actor = authenticated_actor(payload.get('identity_token'))
    except Exception:
        return {'status': 'unauthorized', 'message': 'Runtime authentication failed. Configure a valid user JWT, or the explicit IAM single-user mode for a private workspace.'}
    try:
        # Runtime routes a runtimeSessionId to one microVM. File locking also covers
        # multiple local workers. Cloud callers must serialize turns per session.
        with open('/tmp/alphaforge-turn.lock', 'a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            config = AgentCoreMemoryConfig(
                memory_id=os.environ['AGENTCORE_MEMORY_ID'], actor_id=actor,
                session_id=memory_session_id(actor, session), batch_size=1,
                retrieval_config=None)
            with StrictMemorySessionManager(config, region_name=os.environ.get('AWS_REGION')) as manager:
                if new != manager._is_new_session:
                    raise ConversationError('Conversation exists or has expired; do not reset implicitly.')
                agent = create_agent(manager, tools=[])
                record = agent.state.get('portfolio')
                if new:
                    record = {'schema': 1, 'confirmed': {}, 'pending': None, 'revision': None}
                elif not isinstance(record, dict) or record.get('schema') != 1 or record.get('revision') != payload['revision']:
                    raise ConversationError('Missing state or stale revision.')
                if not new and not agent.messages:
                    raise ConversationError('Conversation history is missing.')
                validate_patch(record['confirmed'])
                if payload.get('confirm_proposal'):
                    if record['pending'] is None:
                        raise ConversationError('No proposal to confirm.')
                    patch = record['pending']
                if record['pending'] is not None:
                    validate_patch(record['pending'])
                record['confirmed'] = merge_constraints(record['confirmed'], patch)
                if patch or payload.get('confirm_proposal') or payload.get('reject_proposal'):
                    record['pending'] = None
                # Persist restrictions BEFORE any model or optimizer invocation.
                record['revision'] = str(uuid.uuid4())
                agent.state.set('portfolio', record)
                manager.sync_agent(agent)
                tool_results = []
                for session_tool in session_tools(record, tool_results):
                    agent.tool_registry.register_tool(session_tool)
                agent.system_prompt = INSTRUCTIONS + '\nAuthoritative session state: ' + json.dumps(record)
                if payload.get('reject_proposal'):
                    # Rejection is deterministic and cannot be reinterpreted as confirmation.
                    result = 'Proposed changes discarded. Your confirmed constraints are unchanged.'
                    for message in [{'role': 'user', 'content': [{'text': prompt}]},
                                    {'role': 'assistant', 'content': [{'text': result}]}]:
                        agent.messages.append(message)
                        manager.append_message(message, agent)
                else:
                    result = agent(prompt)
                agent.state.set('portfolio', record)
                manager.sync_agent(agent)
                saved = manager.read_agent(config.session_id, 'alphaforge')
                if saved is None or saved.state.get('portfolio') != record:
                    raise ConversationError('Memory write could not be verified.')
            return {'status': 'ok', 'response': str(result), 'session_id': session,
                    'revision': record['revision'], 'confirmed_constraints': record['confirmed'],
                    'proposed_constraints': record['pending'], 'protocol_version': 2,
                    'portfolio_results': tool_results}
    except Exception:
        # Do not log prompts, JWTs, SDK exception text, or return partial results.
        logging.error('Conversation failed; no result released.')
        return {'status': 'conversation_unavailable', 'message':
                'State could not be safely restored or saved (or the model failed). No portfolio result released. Do not retry with new_conversation on this ID. Recover the last state or explicitly start a new UUID and reconfirm all limits.'}


if __name__ == '__main__':
    app.run()
