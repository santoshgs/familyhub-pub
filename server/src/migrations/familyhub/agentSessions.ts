import type { Migration } from '../runner';

/**
 * Connected apps (agent sessions): one revocable, expiring credential per
 * outside tool, such as an MCP server. Only a hash of the token is kept. The
 * session acts as the parent who created it, limited to `permissions`
 * (server/src/lib/agentSessions.ts), and its session id is logged with every
 * write it makes. Additive only: an app rollback ignores the tables.
 */
export const agentSessionMigrations: readonly Migration[] = [{
    id: 'familyhub/0020-agent-sessions',
    statements: [
        `CREATE TABLE IF NOT EXISTS familyhub_agent_sessions (
            id UUID PRIMARY KEY,
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
            token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
            permissions JSONB NOT NULL,
            creator_token_version INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_used_at TIMESTAMPTZ,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ
        )`,
        'CREATE INDEX IF NOT EXISTS familyhub_agent_sessions_family_idx ON familyhub_agent_sessions (family_id) WHERE revoked_at IS NULL',
        // Every change a connected app makes or attempts: which session, as which
        // parent, what it called and how it was answered. Never the request body.
        `CREATE TABLE IF NOT EXISTS familyhub_agent_writes (
            id BIGSERIAL PRIMARY KEY,
            session_id UUID NOT NULL REFERENCES familyhub_agent_sessions(id) ON DELETE CASCADE,
            family_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            method TEXT NOT NULL CHECK (char_length(method) <= 10),
            path TEXT NOT NULL CHECK (char_length(path) <= 300),
            status SMALLINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
        'CREATE INDEX IF NOT EXISTS familyhub_agent_writes_session_idx ON familyhub_agent_writes (session_id, id DESC)',
        'CREATE INDEX IF NOT EXISTS familyhub_agent_writes_family_idx ON familyhub_agent_writes (family_id, id DESC)',
    ],
}];
