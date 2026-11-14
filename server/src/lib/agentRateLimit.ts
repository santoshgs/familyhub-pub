/**
 * A per-session rate limit for connected apps (agent sessions).
 *
 * Each session has its own allowance, counted in a fixed window and kept in
 * memory: it starts again when the server restarts, which is acceptable for a
 * single-process household server. Reads and changes are counted separately and
 * changes get the tighter allowance, so a runaway client or a model stuck in a
 * loop cannot flood Google or the database, whatever its grants.
 *
 * authMiddleware calls this for every request made with an agent key, before
 * the grants are checked, so refused attempts count too. Read
 * docs/familyhub/AGENT_API.md before changing it.
 */

export type AgentCallKind = 'read' | 'write';

export interface AgentRateLimitConfig {
    windowMs: number;
    /** Allowed GET/HEAD requests per window, per session. */
    reads: number;
    /** Allowed requests with any other method per window, per session. */
    writes: number;
}

export const DEFAULT_AGENT_RATE_LIMIT: AgentRateLimitConfig = { windowMs: 60_000, reads: 120, writes: 10 };

export interface AgentRateDecision {
    allowed: boolean;
    limit: number;
    remaining: number;
    /** Whole seconds until the window ends (at least 1). */
    resetSeconds: number;
    /** True for the first refusal in a window, so it can be logged once. */
    firstRefusal: boolean;
}

const positiveInt = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** The limits from the environment (AGENT_RATE_LIMIT_*), falling back to the defaults on anything unusable. */
export const agentRateLimitFromEnv = (env: NodeJS.ProcessEnv = process.env): AgentRateLimitConfig => ({
    windowMs: positiveInt(env.AGENT_RATE_LIMIT_WINDOW_MS, DEFAULT_AGENT_RATE_LIMIT.windowMs),
    reads: positiveInt(env.AGENT_RATE_LIMIT_READS, DEFAULT_AGENT_RATE_LIMIT.reads),
    writes: positiveInt(env.AGENT_RATE_LIMIT_WRITES, DEFAULT_AGENT_RATE_LIMIT.writes),
});

export const agentCallKind = (method: string): AgentCallKind => {
    const verb = method.toUpperCase();
    return verb === 'GET' || verb === 'HEAD' ? 'read' : 'write';
};

interface Counter { windowEnds: number; count: number; refused: boolean }

export class AgentRateLimiter {
    private readonly counters = new Map<string, Counter>();

    constructor(
        private config: AgentRateLimitConfig = agentRateLimitFromEnv(),
        private readonly now: () => number = Date.now,
    ) {}

    /** Counts one request for the session and says whether it may go ahead. */
    check(sessionId: string, method: string): AgentRateDecision {
        const kind = agentCallKind(method);
        const limit = kind === 'write' ? this.config.writes : this.config.reads;
        const at = this.now();
        this.sweep(at);
        const key = `${sessionId}:${kind}`;
        let counter = this.counters.get(key);
        if (!counter || counter.windowEnds <= at) {
            counter = { windowEnds: at + this.config.windowMs, count: 0, refused: false };
            this.counters.set(key, counter);
        }
        const resetSeconds = Math.max(1, Math.ceil((counter.windowEnds - at) / 1000));
        if (counter.count >= limit) {
            const firstRefusal = !counter.refused;
            counter.refused = true;
            return { allowed: false, limit, remaining: 0, resetSeconds, firstRefusal };
        }
        counter.count += 1;
        return { allowed: true, limit, remaining: limit - counter.count, resetSeconds, firstRefusal: false };
    }

    /** Replaces the limits and forgets every count (used by tests). */
    configure(config: AgentRateLimitConfig): void {
        this.config = config;
        this.counters.clear();
    }

    /** Forget every session's count (used by tests). */
    reset(): void {
        this.counters.clear();
    }

    // Counters of finished windows are dropped as new requests arrive, so the
    // map never holds more than the sessions seen within one window.
    private sweep(at: number): void {
        for (const [key, counter] of this.counters) {
            if (counter.windowEnds <= at) this.counters.delete(key);
        }
    }
}

/** The limiter authMiddleware uses. */
export const agentRateLimiter = new AgentRateLimiter();
