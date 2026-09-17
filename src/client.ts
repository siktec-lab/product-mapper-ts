/**
 * The ProductMapper client: one method per public API operation, plus polling helpers
 * that turn the queue-based endpoints into a single await.
 */
import { DEFAULT_BASE_URL, request, type HttpConfig } from './http.js';
import { JobFailedError, ProductMapperError, TimeoutError, ValidationError } from './errors.js';
import type {
    BatchJob,
    BatchOptions,
    HistoryOptions,
    HistoryPage,
    JobStatus,
    LookupOptions,
    MappingResult,
    ProductMapperOptions,
    QueuedLookup,
    WaitBatchOptions,
    WaitJobOptions
} from './types.js';

const VERSION = '0.1.0';
const MAX_BATCH_ITEMS = 500;
const MAX_JOB_IDS = 100;
const DEFAULT_JOB_TIMEOUT = 120_000;
const DEFAULT_JOB_INTERVAL = 1_500;
const DEFAULT_BATCH_TIMEOUT = 600_000;
const DEFAULT_BATCH_INTERVAL = 3_000;

/**
 * Client for the ProductMapper API.
 *
 * ```ts
 * const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY! });
 * const result = await client.lookup({ value: '079361039905', type: 'UPC' });
 * console.log(result.listingDetails?.title, result.listingDetails?.price);
 * ```
 */
export class ProductMapper {
    private readonly config: HttpConfig;

    constructor(options: ProductMapperOptions) {
        if (!options?.apiKey || typeof options.apiKey !== 'string') {
            throw new ValidationError(
                'An apiKey is required. Generate one at https://product-mapper.com/dashboard/api-keys'
            );
        }
        const fetchImpl = options.fetch ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new ProductMapperError(
                'No fetch implementation found. Use Node 18 or newer, or pass a custom fetch.'
            );
        }
        this.config = {
            apiKey: options.apiKey,
            baseUrl: (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
            timeout: options.timeout ?? 30_000,
            maxRetries: options.maxRetries ?? 2,
            headers: options.headers ?? {},
            fetch: fetchImpl.bind(globalThis),
            userAgent: `productmapper-node/${VERSION}`
        };
    }

    /** The API origin this client talks to. */
    get baseUrl(): string {
        return this.config.baseUrl;
    }

    /**
     * Resolve a single UPC, EAN, GTIN, ASIN or free-text title into an Amazon listing.
     * Charges one credit per successful mapping.
     *
     * If the server needs more than 8 seconds it queues the work and returns a job.
     * By default this method polls that job until it resolves, so you always get a
     * MappingResult back. Pass `poll: false` to receive the job handle instead.
     *
     * @throws NotFoundError when the identifier has no match in the Amazon catalog.
     * @throws CreditsExhaustedError when the organization is out of credits.
     * @throws RateLimitError when the plan requests-per-minute ceiling is exceeded.
     */
    async lookup(options: LookupOptions & { poll?: true }): Promise<MappingResult>;
    async lookup(options: LookupOptions & { poll: false }): Promise<MappingResult | QueuedLookup>;
    async lookup(options: LookupOptions): Promise<MappingResult | QueuedLookup> {
        if (!options?.value || typeof options.value !== 'string' || !options.value.trim()) {
            throw new ValidationError('lookup() requires a non-empty "value"');
        }

        const body: Record<string, unknown> = { value: options.value };
        if (options.type && options.type !== 'auto') body.type = options.type;
        if (options.marketplace) body.marketplace = options.marketplace;
        if (options.region) body.region = options.region;

        const response = await request<MappingResult | QueuedLookup>(this.config, {
            method: 'POST',
            path: 'api/map',
            body,
            signal: options.signal
        });

        if (!isQueued(response)) return response;
        if (options.poll === false) return response;

        return this.waitForJob(response.jobId, {
            timeout: options.pollTimeout ?? DEFAULT_JOB_TIMEOUT,
            interval: options.pollInterval ?? DEFAULT_JOB_INTERVAL,
            signal: options.signal
        });
    }

    /**
     * Submit up to 500 identifiers as one background batch job.
     * Returns immediately with the created job. Poll it with getBatch(), or await
     * waitForBatch() to block until every item is processed.
     */
    async lookupMany(items: string[], options: BatchOptions = {}): Promise<BatchJob> {
        if (!Array.isArray(items) || items.length === 0) {
            throw new ValidationError('lookupMany() requires a non-empty array of identifiers');
        }
        if (items.length > MAX_BATCH_ITEMS) {
            throw new ValidationError(
                `lookupMany() accepts at most ${MAX_BATCH_ITEMS} items per request, got ${items.length}`
            );
        }

        const body: Record<string, unknown> = { items };
        if (options.marketplace) body.marketplace = options.marketplace;

        return request<BatchJob>(this.config, {
            method: 'POST',
            path: 'api/map/batch',
            body,
            signal: options.signal
        });
    }

    /** Poll one queued single lookup by the job id a non-polling lookup() returned. */
    async getJob(jobId: string, signal?: AbortSignal): Promise<JobStatus> {
        if (!jobId) throw new ValidationError('getJob() requires a job id');
        return request<JobStatus>(this.config, {
            method: 'GET',
            path: `api/jobs/${encodeURIComponent(jobId)}`,
            signal
        });
    }

    /**
     * Poll up to 100 queued single lookups in one round trip.
     * Returns a map of job id to the same status shape getJob() returns.
     */
    async getJobs(jobIds: string[], signal?: AbortSignal): Promise<Record<string, JobStatus>> {
        if (!Array.isArray(jobIds) || jobIds.length === 0) {
            throw new ValidationError('getJobs() requires a non-empty array of job ids');
        }
        if (jobIds.length > MAX_JOB_IDS) {
            throw new ValidationError(
                `getJobs() accepts at most ${MAX_JOB_IDS} ids per request, got ${jobIds.length}`
            );
        }
        const response = await request<{ jobs?: Record<string, JobStatus> }>(this.config, {
            method: 'GET',
            path: 'api/jobs',
            query: { ids: jobIds.join(',') },
            signal
        });
        return response.jobs ?? {};
    }

    /** Fetch a batch job, including its items once processing has started. */
    async getBatch(batchId: string, signal?: AbortSignal): Promise<BatchJob> {
        if (!batchId) throw new ValidationError('getBatch() requires a batch id');
        return request<BatchJob>(this.config, {
            method: 'GET',
            path: `api/jobs/batch/${encodeURIComponent(batchId)}`,
            signal
        });
    }

    /** Export a batch job as an RFC 4180 CSV string. */
    async getBatchCsv(batchId: string, signal?: AbortSignal): Promise<string> {
        if (!batchId) throw new ValidationError('getBatchCsv() requires a batch id');
        return request<string>(this.config, {
            method: 'GET',
            path: `api/jobs/batch/${encodeURIComponent(batchId)}`,
            query: { format: 'csv' },
            responseType: 'text',
            signal
        });
    }

    /**
     * List your lookup history, 25 rows per page.
     * `search` matches identifier value or product title, case-insensitive and partial.
     */
    async history(options: HistoryOptions = {}): Promise<HistoryPage> {
        return request<HistoryPage>(this.config, {
            method: 'GET',
            path: 'api/history',
            query: { page: options.page, search: options.search },
            signal: options.signal
        });
    }

    /**
     * Iterate every history row across all pages, fetching each page as you go.
     *
     * ```ts
     * for await (const row of client.historyAll()) console.log(row.identifierValue);
     * ```
     */
    async *historyAll(
        options: Omit<HistoryOptions, 'page'> = {}
    ): AsyncGenerator<HistoryPage['history'][number]> {
        let page = 1;
        let totalPages = 1;
        do {
            const result = await this.history({ ...options, page });
            totalPages = result.totalPages ?? 1;
            for (const row of result.history ?? []) yield row;
            page += 1;
        } while (page <= totalPages);
    }

    /** Clear your entire lookup history. Rows are hidden at once and hard-deleted after 24 hours. */
    async clearHistory(signal?: AbortSignal): Promise<void> {
        await request<unknown>(this.config, { method: 'DELETE', path: 'api/history', signal });
    }

    /** Delete one history row by id. */
    async deleteHistoryRow(rowId: string, signal?: AbortSignal): Promise<void> {
        if (!rowId) throw new ValidationError('deleteHistoryRow() requires a row id');
        await request<unknown>(this.config, {
            method: 'DELETE',
            path: `api/history/${encodeURIComponent(rowId)}`,
            signal
        });
    }

    /**
     * Poll a queued single lookup until it completes, fails or times out.
     *
     * @throws JobFailedError when the job ends in a failed state.
     * @throws TimeoutError when the job is still processing at the deadline.
     */
    async waitForJob(jobId: string, options: WaitJobOptions = {}): Promise<MappingResult> {
        const timeout = options.timeout ?? DEFAULT_JOB_TIMEOUT;
        const interval = options.interval ?? DEFAULT_JOB_INTERVAL;
        const deadline = Date.now() + timeout;

        for (;;) {
            const status = await this.getJob(jobId, options.signal);
            if (status.status === 'completed') return status.data;
            if (status.status === 'failed') {
                throw new JobFailedError(status.error || `Job ${jobId} failed`, {
                    jobId,
                    body: status
                });
            }
            if (Date.now() + interval > deadline) {
                throw new TimeoutError(
                    `Job ${jobId} was still processing after ${timeout}ms. Poll getJob("${jobId}") to keep waiting.`
                );
            }
            await delay(interval, options.signal);
        }
    }

    /**
     * Poll a batch job until every item has been processed, or it fails or times out.
     * `onProgress` is called after each poll, which is where a progress bar belongs.
     *
     * @throws JobFailedError when the batch ends in a failed state.
     * @throws TimeoutError when the batch is still running at the deadline.
     */
    async waitForBatch(batchId: string, options: WaitBatchOptions = {}): Promise<BatchJob> {
        const timeout = options.timeout ?? DEFAULT_BATCH_TIMEOUT;
        const interval = options.interval ?? DEFAULT_BATCH_INTERVAL;
        const deadline = Date.now() + timeout;

        for (;;) {
            const job = await this.getBatch(batchId, options.signal);
            options.onProgress?.(job);
            if (job.status === 'completed') return job;
            if (job.status === 'failed') {
                throw new JobFailedError(`Batch job ${batchId} failed`, { jobId: batchId, body: job });
            }
            if (Date.now() + interval > deadline) {
                throw new TimeoutError(
                    `Batch job ${batchId} was still running after ${timeout}ms (${job.processedItems}/${job.totalItems} processed). Poll getBatch("${batchId}") to keep waiting.`
                );
            }
            await delay(interval, options.signal);
        }
    }
}

function isQueued(value: MappingResult | QueuedLookup): value is QueuedLookup {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as QueuedLookup).status === 'processing' &&
        typeof (value as QueuedLookup).jobId === 'string'
    );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new ProductMapperError('Polling aborted', { cause: signal.reason }));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(new ProductMapperError('Polling aborted', { cause: signal?.reason }));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
