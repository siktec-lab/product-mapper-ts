/**
 * The HTTP layer: one place that knows about auth headers, timeouts, retries and
 * turning a failed response into a typed error. The client in client.ts stays a thin
 * mapping from methods to endpoints on top of this.
 */
import {
    ConnectionError,
    ProductMapperError,
    RateLimitError,
    ServerError,
    TimeoutError,
    errorFromResponse
} from './errors.js';

export const DEFAULT_BASE_URL = 'https://product-mapper.com';
/** Never sleep longer than this between retries, even if Retry-After asks for more. */
const MAX_RETRY_DELAY = 30_000;

export interface RequestOptions {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    signal?: AbortSignal;
    /** Read the response as text rather than JSON, used by the CSV export. */
    responseType?: 'json' | 'text';
}

export interface HttpConfig {
    apiKey: string;
    baseUrl: string;
    timeout: number;
    maxRetries: number;
    headers: Record<string, string>;
    fetch: typeof globalThis.fetch;
    userAgent: string;
}

/** Sleep that rejects promptly if the caller aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError(signal));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError(signal));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function abortError(signal?: AbortSignal): ProductMapperError {
    const reason = signal?.reason;
    if (reason instanceof ProductMapperError) return reason;
    return new ProductMapperError('Request aborted', { cause: reason });
}

/** Full jitter backoff, so a fleet of clients does not retry in lockstep. */
function backoffDelay(attempt: number): number {
    const base = Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY);
    return Math.round(base * (0.5 + Math.random() * 0.5));
}

function buildUrl(
    baseUrl: string,
    path: string,
    query?: Record<string, string | number | undefined>
): string {
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
        }
    }
    return url.toString();
}

/**
 * Perform one API request, retrying transient failures.
 *
 * Retries cover 429, 5xx and network errors. A 429 honors Retry-After when the server
 * sends one. Everything else, including validation and auth failures, fails immediately,
 * since repeating those requests would only burn quota.
 */
export async function request<T>(config: HttpConfig, options: RequestOptions): Promise<T> {
    const url = buildUrl(config.baseUrl, options.path, options.query);
    const label = `${options.method} ${options.path}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: options.responseType === 'text' ? 'text/csv, application/json' : 'application/json',
        'User-Agent': config.userAgent,
        ...config.headers
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let lastError: ProductMapperError | undefined;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        if (attempt > 0) {
            const wait =
                lastError instanceof RateLimitError && lastError.retryAfter !== undefined
                    ? Math.min(lastError.retryAfter * 1000, MAX_RETRY_DELAY)
                    : backoffDelay(attempt - 1);
            await sleep(wait, options.signal);
        }

        const timeoutController = new AbortController();
        const timer = setTimeout(
            () => timeoutController.abort(new TimeoutError(`${label} timed out after ${config.timeout}ms`)),
            config.timeout
        );
        const signal = mergeSignals(timeoutController.signal, options.signal);

        try {
            const response = await config.fetch(url, {
                method: options.method,
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal
            });

            if (response.ok) {
                if (options.responseType === 'text') return (await response.text()) as T;
                if (response.status === 204) return undefined as T;
                return (await parseJson(response, label)) as T;
            }

            const body = await safeJson(response);
            const error = errorFromResponse(response.status, body, label, response.headers);
            if (!isRetryable(error) || attempt === config.maxRetries) throw error;
            lastError = error;
        } catch (err) {
            if (err instanceof ProductMapperError) {
                // Retryable errors thrown above fall through to the next attempt; anything
                // else, including a caller abort, propagates as-is.
                if (isRetryable(err) && attempt < config.maxRetries) {
                    lastError = err;
                } else {
                    throw err;
                }
            } else if (isAbort(err)) {
                // The timeout controller fires with a TimeoutError as its reason.
                const reason = timeoutController.signal.reason;
                if (reason instanceof TimeoutError) {
                    if (attempt === config.maxRetries) throw reason;
                    lastError = reason;
                } else {
                    throw abortError(options.signal);
                }
            } else {
                const wrapped = new ConnectionError(
                    `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
                    { request: label, cause: err }
                );
                if (attempt === config.maxRetries) throw wrapped;
                lastError = wrapped;
            }
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError ?? new ProductMapperError(`${label} failed`, { request: label });
}

function isRetryable(error: ProductMapperError): boolean {
    return (
        error instanceof RateLimitError ||
        error instanceof ServerError ||
        error instanceof ConnectionError ||
        error instanceof TimeoutError
    );
}

function isAbort(err: unknown): boolean {
    return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

async function parseJson(response: Response, label: string): Promise<unknown> {
    const text = await response.text();
    if (!text) return undefined;
    try {
        return JSON.parse(text);
    } catch {
        throw new ProductMapperError(`${label} returned a non-JSON response`, {
            status: response.status,
            body: text,
            request: label
        });
    }
}

async function safeJson(response: Response): Promise<unknown> {
    try {
        const text = await response.text();
        return text ? JSON.parse(text) : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Combine the internal timeout signal with a caller-supplied one.
 * Uses AbortSignal.any where available, with a listener-based fallback for older runtimes.
 */
function mergeSignals(primary: AbortSignal, secondary?: AbortSignal): AbortSignal {
    if (!secondary) return primary;
    const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
    if (typeof anyFn === 'function') return anyFn([primary, secondary]);

    const controller = new AbortController();
    const forward = (signal: AbortSignal) => () => controller.abort(signal.reason);
    if (primary.aborted) controller.abort(primary.reason);
    else if (secondary.aborted) controller.abort(secondary.reason);
    else {
        primary.addEventListener('abort', forward(primary), { once: true });
        secondary.addEventListener('abort', forward(secondary), { once: true });
    }
    return controller.signal;
}
