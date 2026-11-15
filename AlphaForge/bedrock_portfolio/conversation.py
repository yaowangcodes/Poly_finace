"""Authentication and fail-closed STM support; no portfolio mathematics here."""
import hashlib
import json
import os
import re
from functools import lru_cache

import jwt
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager


class ConversationError(ValueError):
    pass


@lru_cache(maxsize=4)
def jwks_client(url):
    if not url.startswith('https://'):
        raise ConversationError('AUTH_JWKS_URL must use HTTPS.')
    return jwt.PyJWKClient(url, timeout=5)


def authenticated_actor(token):
    """Never trust actor IDs or unverified JWT claims, even behind IAM."""
    mode = os.environ.get('AUTH_MODE', 'jwt')
    if mode == 'iam_single_user':
        # The existing Runtime endpoint must use IAM inbound auth and restrict
        # InvokeAgentRuntime to the owner/trusted web role. Never take actor ID
        # from a request; all authorized calls deliberately share one owner.
        actor = os.environ.get('SINGLE_USER_ACTOR_ID', '')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', actor):
            raise ConversationError('Configure a stable SINGLE_USER_ACTOR_ID.')
        if token:
            raise ConversationError('Single-user mode does not accept identity tokens.')
        return 'single-user-' + actor
    if mode != 'jwt':
        raise ConversationError('Unsupported authentication mode.')
    if not isinstance(token, str) or len(token) > 16000:
        raise ConversationError('A valid identity_token is required.')
    issuer, audience = os.environ['AUTH_ISSUER'], os.environ['AUTH_AUDIENCE']
    key = jwks_client(os.environ['AUTH_JWKS_URL']).get_signing_key_from_jwt(token)
    claims = jwt.decode(token, key.key, algorithms=['RS256'], issuer=issuer,
                        audience=audience, options={'require': ['exp', 'iss', 'aud', 'sub']})
    if not isinstance(claims['sub'], str) or not claims['sub']:
        raise ConversationError('Token subject is missing.')
    return 'user-' + hashlib.sha256(json.dumps([issuer, claims['sub']]).encode()).hexdigest()


def memory_session_id(actor, session):
    # Also isolates the SDK's legacy fallback namespaces, which omit actor ID.
    return hashlib.sha256(f'{actor}:{session}'.encode()).hexdigest()


class StrictMemorySessionManager(AgentCoreMemorySessionManager):
    """Keep the supported integration, but prevent its read-error fallbacks."""
    def read_agent(self, session_id, agent_id, **kwargs):
        # SDK 1.26 catches errors here. Capture the underlying read exception and
        # rethrow it after the SDK returns; missing/corrupt existing state also fails.
        original = self.memory_client.list_events
        failures = []

        def read(*args, **kw):
            try:
                return original(*args, **kw)
            except Exception as exc:
                failures.append(exc)
                raise

        self.memory_client.list_events = read
        try:
            result = super().read_agent(session_id, agent_id, **kwargs)
        finally:
            self.memory_client.list_events = original
        if failures:
            raise ConversationError('Memory read failed.') from failures[0]
        if result is None and not self._is_new_session:
            raise ConversationError('Stored conversation state is missing or invalid.')
        return result

    def list_messages(self, session_id, agent_id, limit=None, offset=0, **kwargs):
        # Same SDK conversion, with pagination delegated to MemoryClient, but no
        # catch-and-return-empty path and no legacy/cross-session context retrieval.
        if session_id != self.config.session_id:
            raise ConversationError('Session mismatch.')
        events = self.memory_client.list_events(
            memory_id=self.config.memory_id, actor_id=self.config.actor_id,
            session_id=session_id, max_results=10001)
        if len(events) >= 10001:
            raise ConversationError("Conversation exceeds safe restoration limit; start a new conversation.")
        messages = self.converter.events_to_messages(events)
        return messages[offset:offset + limit] if limit is not None else messages[offset:]
