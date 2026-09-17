import { describe, it, expect, vi } from 'vitest';
import {
    ProductMapper,
    ValidationError,
    AuthenticationError,
    CreditsExhaustedError,
    RateLimitError,
    NotFoundError,
    JobFailedError,
    TimeoutError
} from '../src/index.js';
import type { MappingResult, QueuedLookup } from '../src/index.js';

const API_KEY = 'pm_live_test_key';

interface StubCall {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
}

/** Build a fetch stub that replays a queue of responses and records every call. */
function stubFetch(responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string>; text?: string }>) {
    const calls: StubCall[] = [];
    let index = 0;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
        const spec = responses[Math.min(index, responses.length - 1)];
        index += 1;
        calls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? JSON.parse(String(init.body)) : undefined
        });
        const payload = spec?.text ?? JSON.stringify(spec?.body ?? {});
        return new Response(payload, {
            status: spec?.status ?? 200,
            headers: spec?.headers ?? { 'Content-Type': 'application/json' }
        });
    });
    return { fetchImpl: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

function makeClient(
    responses: Array<{ status?: number; body?: unknown; headers?: Record<string, string>; text?: string }>,
    overrides: Partial<ConstructorParameters<typeof ProductMapper>[0]> = {}
) {
    const { fetchImpl, calls } = stubFetch(responses);
    const client = new ProductMapper({
        apiKey: API_KEY,
        fetch: fetchImpl,
        maxRetries: 0,
        ...overrides
    });
    return { client, calls, fetchImpl };
}

const resultFixture: MappingResult = {
    identifierType: 'UPC',
    identifierValue: '079361039905',
    marketplace: 'amazon',
    marketplaceId: 'B004U9VVX6',
    amazonMarketplaceLabel: 'US',
    timestamp: 1_700_000_000_000,
    listingDetails: {
        asin: 'B004U9VVX6',
        title: 'Example Product',
        brand: 'ExampleBrand',
        imageUrl: 'https://example.com/i.jpg',
        price: 24.99,
        formattedPrice: '$24.99',
        listPrice: null,
        offerCount: 3,
        offerCountFba: null,
        offerCountMerchant: null,
        isBuyBoxWinner: true,
        salesRank: 1234,
        link: 'https://www.amazon.com/dp/B004U9VVX6',
        isActive: true
    }
};

describe('constructor', () => {
    it('requires an api key', () => {
        expect(() => new ProductMapper({ apiKey: '' })).toThrow(ValidationError);
    });

    it('defaults to the public base url and strips trailing slashes', () => {
        const a = new ProductMapper({ apiKey: API_KEY });
        expect(a.baseUrl).toBe('https://product-mapper.com');
        const b = new ProductMapper({ apiKey: API_KEY, baseUrl: 'http://localhost:5188/' });
        expect(b.baseUrl).toBe('http://localhost:5188');
    });
});

describe('lookup', () => {
    it('sends a bearer token and returns the mapping result', async () => {
        const { client, calls } = makeClient([{ body: resultFixture }]);
        const result = await client.lookup({ value: '079361039905', type: 'UPC' });

        expect(result.listingDetails?.title).toBe('Example Product');
        expect(result.listingDetails?.price).toBe(24.99);
        expect(calls[0]!.method).toBe('POST');
        expect(calls[0]!.url).toBe('https://product-mapper.com/api/map');
        expect(calls[0]!.headers.Authorization).toBe(`Bearer ${API_KEY}`);
        expect(calls[0]!.body).toEqual({ value: '079361039905', type: 'UPC' });
    });

    it('omits the auto type and passes region through', async () => {
        const { client, calls } = makeClient([{ body: resultFixture }]);
        await client.lookup({ value: 'coffee maker', type: 'auto', region: 'CA' });
        expect(calls[0]!.body).toEqual({ value: 'coffee maker', region: 'CA' });
    });

    it('rejects an empty value before making a request', async () => {
        const { client, calls } = makeClient([{ body: resultFixture }]);
        await expect(client.lookup({ value: '   ' })).rejects.toThrow(ValidationError);
        expect(calls).toHaveLength(0);
    });

    it('polls a queued lookup until it completes', async () => {
        const { client, calls } = makeClient([
            { status: 202, body: { status: 'processing', message: 'queued', jobId: 'job-1' } },
            { body: { status: 'processing', message: 'still going' } },
            { body: { status: 'completed', data: resultFixture } }
        ]);

        const result = await client.lookup({ value: '079361039905', pollInterval: 1 });
        expect(result.listingDetails?.asin).toBe('B004U9VVX6');
        expect(calls).toHaveLength(3);
        expect(calls[1]!.url).toBe('https://product-mapper.com/api/jobs/job-1');
    });

    it('returns the job handle when polling is disabled', async () => {
        const { client, calls } = makeClient([
            { status: 202, body: { status: 'processing', message: 'queued', jobId: 'job-2' } }
        ]);

        const result = (await client.lookup({ value: 'x', poll: false })) as QueuedLookup;
        expect(result.status).toBe('processing');
        expect(result.jobId).toBe('job-2');
        expect(calls).toHaveLength(1);
    });

    it('surfaces a failed job as JobFailedError', async () => {
        const { client } = makeClient([
            { status: 202, body: { status: 'processing', jobId: 'job-3' } },
            { body: { status: 'failed', error: 'resolution failed' } }
        ]);
        await expect(client.lookup({ value: 'x', pollInterval: 1 })).rejects.toThrow(JobFailedError);
    });

    it('times out a job that never resolves', async () => {
        const { client } = makeClient([
            { status: 202, body: { status: 'processing', jobId: 'job-4' } },
            { body: { status: 'processing' } }
        ]);
        await expect(
            client.lookup({ value: 'x', pollInterval: 5, pollTimeout: 1 })
        ).rejects.toThrow(TimeoutError);
    });
});

describe('errors', () => {
    it('maps 401 to AuthenticationError', async () => {
        const { client } = makeClient([{ status: 401, body: { error: 'Unauthorized' } }]);
        await expect(client.lookup({ value: 'x' })).rejects.toThrow(AuthenticationError);
    });

    it('maps 403 with CREDITS_EXHAUSTED to CreditsExhaustedError', async () => {
        const { client } = makeClient([
            { status: 403, body: { error: 'out of credits', code: 'CREDITS_EXHAUSTED' } }
        ]);
        const error = await client.lookup({ value: 'x' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(CreditsExhaustedError);
        expect((error as CreditsExhaustedError).code).toBe('CREDITS_EXHAUSTED');
    });

    it('maps 404 to NotFoundError', async () => {
        const { client } = makeClient([{ status: 404, body: { error: 'no match' } }]);
        await expect(client.lookup({ value: 'x' })).rejects.toThrow(NotFoundError);
    });

    it('exposes rate limit metadata on 429', async () => {
        const { client } = makeClient([
            {
                status: 429,
                body: { error: 'slow down', code: 'RATE_LIMITED' },
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': '7',
                    'X-RateLimit-Limit': '60',
                    'X-RateLimit-Remaining': '0'
                }
            }
        ]);
        const error = await client.lookup({ value: 'x' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).retryAfter).toBe(7);
        expect((error as RateLimitError).limit).toBe(60);
        expect((error as RateLimitError).remaining).toBe(0);
    });

    it('retries a 500 and then succeeds', async () => {
        const { client, calls } = makeClient(
            [{ status: 500, body: { error: 'boom' } }, { body: resultFixture }],
            { maxRetries: 1 }
        );
        const result = await client.lookup({ value: 'x' });
        expect(result.identifierValue).toBe('079361039905');
        expect(calls).toHaveLength(2);
    });

    it('does not retry a 400', async () => {
        const { client, calls } = makeClient([{ status: 400, body: { error: 'bad' } }], {
            maxRetries: 3
        });
        await expect(client.lookup({ value: 'x' })).rejects.toThrow(ValidationError);
        expect(calls).toHaveLength(1);
    });
});

describe('batch', () => {
    const batchFixture = {
        id: 'batch-1',
        userId: 'user_1',
        orgId: 'org_1',
        marketplace: 'amazon',
        totalItems: 2,
        processedItems: 0,
        matchedItems: 0,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z'
    };

    it('submits items and returns the job', async () => {
        const { client, calls } = makeClient([{ status: 202, body: batchFixture }]);
        const job = await client.lookupMany(['079361039905', 'B004U9VVX6']);
        expect(job.id).toBe('batch-1');
        expect(calls[0]!.url).toBe('https://product-mapper.com/api/map/batch');
        expect(calls[0]!.body).toEqual({ items: ['079361039905', 'B004U9VVX6'] });
    });

    it('rejects an empty list and an oversized list', async () => {
        const { client } = makeClient([{ body: batchFixture }]);
        await expect(client.lookupMany([])).rejects.toThrow(ValidationError);
        await expect(client.lookupMany(new Array(501).fill('x'))).rejects.toThrow(ValidationError);
    });

    it('waits for a batch and reports progress', async () => {
        const { client } = makeClient([
            { body: { ...batchFixture, status: 'processing', processedItems: 1 } },
            { body: { ...batchFixture, status: 'completed', processedItems: 2, matchedItems: 2 } }
        ]);
        const seen: number[] = [];
        const job = await client.waitForBatch('batch-1', {
            interval: 1,
            onProgress: (j) => seen.push(j.processedItems)
        });
        expect(job.status).toBe('completed');
        expect(seen).toEqual([1, 2]);
    });

    it('fetches a csv export', async () => {
        const { client, calls } = makeClient([
            { text: 'id,title\n1,Example', headers: { 'Content-Type': 'text/csv' } }
        ]);
        const csv = await client.getBatchCsv('batch-1');
        expect(csv).toBe('id,title\n1,Example');
        expect(calls[0]!.url).toContain('format=csv');
    });
});

describe('jobs', () => {
    it('joins ids for a multi-job poll', async () => {
        const { client, calls } = makeClient([
            { body: { jobs: { a: { status: 'processing' }, b: { status: 'failed', error: 'x' } } } }
        ]);
        const jobs = await client.getJobs(['a', 'b']);
        expect(Object.keys(jobs)).toEqual(['a', 'b']);
        expect(calls[0]!.url).toContain('ids=a%2Cb');
    });

    it('rejects more than 100 ids', async () => {
        const { client } = makeClient([{ body: { jobs: {} } }]);
        await expect(client.getJobs(new Array(101).fill('a'))).rejects.toThrow(ValidationError);
    });
});

describe('history', () => {
    const page = (p: number, totalPages: number) => ({
        history: [
            {
                id: `row-${p}`,
                identifierType: 'UPC',
                identifierValue: `0000${p}`,
                marketplace: 'amazon',
                marketplaceId: null,
                title: null,
                brand: null,
                price: null,
                formattedPrice: null,
                imageUrl: null,
                status: 'completed',
                createdAt: '2026-01-01T00:00:00Z'
            }
        ],
        page: p,
        pageSize: 25,
        total: totalPages,
        totalPages
    });

    it('passes page and search as query parameters', async () => {
        const { client, calls } = makeClient([{ body: page(2, 2) }]);
        await client.history({ page: 2, search: 'coffee' });
        expect(calls[0]!.url).toContain('page=2');
        expect(calls[0]!.url).toContain('search=coffee');
    });

    it('iterates every page with historyAll', async () => {
        const { client } = makeClient([{ body: page(1, 3) }, { body: page(2, 3) }, { body: page(3, 3) }]);
        const ids: string[] = [];
        for await (const row of client.historyAll()) ids.push(row.id);
        expect(ids).toEqual(['row-1', 'row-2', 'row-3']);
    });

    it('deletes a row and clears history', async () => {
        const { client, calls } = makeClient([{ body: { success: true } }, { body: { success: true } }]);
        await client.deleteHistoryRow('row-1');
        await client.clearHistory();
        expect(calls[0]!.method).toBe('DELETE');
        expect(calls[0]!.url).toBe('https://product-mapper.com/api/history/row-1');
        expect(calls[1]!.url).toBe('https://product-mapper.com/api/history');
    });
});
