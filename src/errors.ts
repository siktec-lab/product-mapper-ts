/**
 * Error types raised by the ProductMapper client.
 *
 * Every failure is an instance of ProductMapperError, so a single catch can handle
 * all of them, while the subclasses let you react to specific conditions such as an
 * exhausted credit balance or a rate limit.
 */

/** Base class for every error this client raises. */
export class ProductMapperError extends Error {
    /** HTTP status, when the failure came from a response. */
    readonly status?: number;
    /** Machine-readable code from the API, for example CREDITS_EXHAUSTED or RATE_LIMITED. */
    readonly code?: string;
    /** Parsed response body, when there was one. */
    readonly body?: unknown;
    /** The request that failed, as method and path. */
    readonly request?: string;

    constructor(
        message: string,
        options: { status?: number; code?: string; body?: unknown; request?: string; cause?: unknown } = {}
    ) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = new.target.name;
        this.status = options.status;
        this.code = options.code;
        this.body = options.body;
        this.request = options.request;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** 400. The request was rejected before any lookup happened. */
export class ValidationError extends ProductMapperError {}

/** 401. The API key is missing, malformed or revoked. */
export class AuthenticationError extends ProductMapperError {}

/** 403 without a credits code. Usually no active organization is selected. */
export class PermissionError extends ProductMapperError {}

/** 403 with code CREDITS_EXHAUSTED. Top up or upgrade to continue. */
export class CreditsExhaustedError extends ProductMapperError {}

/** 404. No match in the Amazon catalog, or the resource does not belong to you. */
export class NotFoundError extends ProductMapperError {}

/** 429. The organization exceeded its plan requests-per-minute ceiling. */
export class RateLimitError extends ProductMapperError {
    /** Seconds to wait before retrying, from the Retry-After header. */
    readonly retryAfter?: number;
    /** Requests per minute allowed on the current plan. */
    readonly limit?: number;
    /** Requests left in the current window. */
    readonly remaining?: number;

    constructor(
        message: string,
        options: {
            status?: number;
            code?: string;
            body?: unknown;
            request?: string;
            retryAfter?: number;
            limit?: number;
            remaining?: number;
        } = {}
    ) {
        super(message, options);
        this.retryAfter = options.retryAfter;
        this.limit = options.limit;
        this.remaining = options.remaining;
    }
}

/** 5xx. The API failed to handle an otherwise valid request. */
export class ServerError extends ProductMapperError {}

/** The request, or a polling loop, exceeded its allotted time. */
export class TimeoutError extends ProductMapperError {}

/** The request never reached the API: DNS, TLS, connection reset, offline. */
export class ConnectionError extends ProductMapperError {}

/** A queued lookup or batch job finished in a failed state. */
export class JobFailedError extends ProductMapperError {
    /** The job id that failed. */
    readonly jobId?: string;

    constructor(message: string, options: { jobId?: string; body?: unknown } = {}) {
        super(message, options);
        this.jobId = options.jobId;
    }
}

/**
 * Build the right error subclass for a failed response.
 *
 * @internal
 */
export function errorFromResponse(
    status: number,
    body: unknown,
    request: string,
    headers?: Headers
): ProductMapperError {
    const record = (body ?? {}) as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message =
        typeof record.error === 'string' && record.error.trim()
            ? record.error
            : `Request failed with status ${status}`;
    const base = { status, code, body, request };

    switch (status) {
        case 400:
            return new ValidationError(message, base);
        case 401:
            return new AuthenticationError(message, base);
        case 403:
            return code === 'CREDITS_EXHAUSTED'
                ? new CreditsExhaustedError(message, base)
                : new PermissionError(message, base);
        case 404:
            return new NotFoundError(message, base);
        case 429:
            return new RateLimitError(message, {
                ...base,
                retryAfter: numericHeader(headers, 'retry-after'),
                limit: numericHeader(headers, 'x-ratelimit-limit'),
                remaining: numericHeader(headers, 'x-ratelimit-remaining')
            });
        default:
            if (status >= 500) return new ServerError(message, base);
            return new ProductMapperError(message, base);
    }
}

function numericHeader(headers: Headers | undefined, name: string): number | undefined {
    const raw = headers?.get(name);
    if (raw === null || raw === undefined) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
}
