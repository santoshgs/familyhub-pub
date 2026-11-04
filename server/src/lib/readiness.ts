import type { RequestHandler } from 'express';

/** Keep infrastructure diagnostics and credentials out of the public response. */
export function readinessHandler(probe: () => Promise<unknown>): RequestHandler {
    return async (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try {
            await probe();
            res.json({ status: 'ready' });
        } catch {
            res.status(503).json({ status: 'unavailable' });
        }
    };
}
