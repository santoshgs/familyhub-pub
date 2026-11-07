/**
 * Express 4 ignores the promise an async route handler returns, so a rejected
 * query (a malformed UUID, a NUL byte, a lost database connection) became an
 * unhandled rejection that ended the Node process for every family. This makes
 * every route and middleware forward a rejection to next(err), where the error
 * handler in app.ts answers it, the way Express 5 does. Import it before any
 * router is created; it patches the shared Layer prototype once.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer') as {
    prototype: { handle_request: (req: unknown, res: unknown, next: (err?: unknown) => void) => unknown; __familyhubAsync?: boolean };
};

if (!Layer.prototype.__familyhubAsync) {
    Layer.prototype.__familyhubAsync = true;
    Layer.prototype.handle_request = function handleRequest(this: { handle: (...args: unknown[]) => unknown }, req: unknown, res: unknown, next: (err?: unknown) => void) {
        const fn = this.handle;
        // Error-handling middleware (arity 4) is not a request handler.
        if (fn.length > 3) return next();
        try {
            const result = fn(req, res, next) as { then?: unknown; catch?: (cb: (err: unknown) => void) => unknown } | undefined;
            if (result && typeof result.then === 'function' && typeof result.catch === 'function') {
                result.catch((err: unknown) => next(err ?? new Error('Rejected without a reason')));
            }
        } catch (err) {
            next(err);
        }
        return undefined;
    };
}

/** PostgreSQL errors caused by bad client input rather than a server fault. */
const CLIENT_INPUT_PG_CODES = new Set([
    '22P02', // invalid_text_representation (e.g. not a UUID)
    '22021', // character_not_in_repertoire (NUL byte)
    '22007', // invalid_datetime_format
    '22008', // datetime_field_overflow
    '22003', // numeric_value_out_of_range
    '22001', // string_data_right_truncation
    '54000', // program_limit_exceeded (e.g. index row too large)
]);

export const isClientInputDbError = (err: unknown): boolean =>
    typeof err === 'object' && err !== null && CLIENT_INPUT_PG_CODES.has(String((err as { code?: unknown }).code));

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

/** Strips trailing slashes in linear time (a `/\/+$/` regex backtracks quadratically). */
export const stripTrailingSlashes = (value: string): string => {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
    return end === value.length ? value : value.slice(0, end);
};

/** True when the string contains a C0 control character or DEL (NUL included). */
export const hasControlChars = (value: string): boolean => /[\u0000-\u001f\u007f]/.test(value);
