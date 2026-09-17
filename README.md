# ProductMapper for Node.js

[![npm version](https://img.shields.io/npm/v/@siktec-lab/productmapper.svg)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![npm downloads](https://img.shields.io/npm/dm/@siktec-lab/productmapper.svg)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![CI](https://github.com/siktec-lab/product-mapper-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/siktec-lab/product-mapper-ts/actions/workflows/ci.yml)
[![Types](https://img.shields.io/npm/types/@siktec-lab/productmapper.svg)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/node/v/@siktec-lab/productmapper.svg)](https://nodejs.org)

Official TypeScript client for [ProductMapper](https://product-mapper.com). Resolve a UPC, EAN, GTIN,
ASIN or free-text title into a live Amazon catalog listing: price, rating, sales rank, offers and images,
across 16 marketplace regions.

- [Website](https://product-mapper.com) | [API docs](https://product-mapper.com/docs) | [Get an API key](https://product-mapper.com/dashboard/api-keys)
- Python version: [productmapper on PyPI](https://pypi.org/project/productmapper/)

## Install

```bash
npm install @siktec-lab/productmapper
```

Requires Node 18 or newer. Ships ESM, CommonJS and full type declarations, with no runtime dependencies.

## Quick start

```ts
import { ProductMapper } from '@siktec-lab/productmapper';

const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY });

const result = await client.lookup({ value: '079361039905', type: 'UPC' });

console.log(result.listingDetails?.title);   // "Example Product"
console.log(result.listingDetails?.price);   // 24.99
console.log(result.marketplaceId);           // "B004U9VVX6" (the matched ASIN)
```

Get your key at [product-mapper.com/dashboard/api-keys](https://product-mapper.com/dashboard/api-keys).
Keys look like `pm_live_...`, and belong in an environment variable, never in source control.

## Single lookup

`type` defaults to `auto`, which lets the server infer the identifier kind from the value.

```ts
await client.lookup({ value: '079361039905' });                    // inferred
await client.lookup({ value: 'B004U9VVX6', type: 'ASIN' });        // explicit
await client.lookup({ value: 'Logitech MX Master 3S', type: 'Title' });
await client.lookup({ value: '079361039905', region: 'CA' });      // one region only
```

Each successful mapping costs one credit. Without a `region`, an identifier matching in several
marketplaces returns them all under `results`, with the top-level fields mirroring `results[0]`, and
still costs a single credit.

```ts
const result = await client.lookup({ value: '079361039905' });
for (const match of result.results ?? [result]) {
    console.log(match.amazonMarketplaceLabel, match.listingDetails?.formattedPrice);
}
```

### Slow lookups

When a lookup takes more than 8 seconds the API queues it and returns a job. By default the client
polls that job for you, so `lookup()` always resolves to a result. To take over the polling yourself,
pass `poll: false`:

```ts
const queued = await client.lookup({ value: '079361039905', poll: false });

if (queued.status === 'processing') {
    const result = await client.waitForJob(queued.jobId);
    console.log(result.listingDetails?.title);
}
```

## Batch lookups

Submit up to 500 identifiers as one background job, then await it:

```ts
const job = await client.lookupMany(['079361039905', 'B004U9VVX6', 'Logitech MX Master 3S']);

const finished = await client.waitForBatch(job.id, {
    onProgress: (j) => console.log(`${j.processedItems}/${j.totalItems}`)
});

for (const item of finished.items ?? []) {
    console.log(item.identifierValue, item.title, item.price);
}
```

Batch rows carry a smaller field set than a single lookup. Look an identifier up individually when you
need `link`, `category`, `identifiers` or the full offer breakdown.

Export the whole batch as CSV:

```ts
const csv = await client.getBatchCsv(job.id);
```

## History

Every lookup is recorded, 25 rows per page.

```ts
const page = await client.history({ page: 1, search: 'coffee' });
console.log(page.total, page.totalPages);

// Or walk every page, one row at a time.
for await (const row of client.historyAll()) {
    console.log(row.identifierValue, row.title);
}

await client.deleteHistoryRow(rowId);
await client.clearHistory();
```

## Error handling

Every failure is a `ProductMapperError`, so one catch can cover them all, with subclasses for the cases
worth reacting to individually.

```ts
import { ProductMapper, NotFoundError, RateLimitError, CreditsExhaustedError } from '@siktec-lab/productmapper';

try {
    const result = await client.lookup({ value: '079361039905' });
} catch (error) {
    if (error instanceof NotFoundError) {
        // No match in the Amazon catalog.
    } else if (error instanceof CreditsExhaustedError) {
        // Out of credits: upgrade the plan or buy a credit pack.
    } else if (error instanceof RateLimitError) {
        console.log(`Retry in ${error.retryAfter}s, limit is ${error.limit}/min`);
    } else {
        throw error;
    }
}
```

| Error | Raised when |
| --- | --- |
| `ValidationError` | 400, or the client rejected the arguments before sending |
| `AuthenticationError` | 401, the API key is missing, malformed or revoked |
| `PermissionError` | 403, usually no active organization is selected |
| `CreditsExhaustedError` | 403 with code `CREDITS_EXHAUSTED` |
| `NotFoundError` | 404, no catalog match, or the resource is not yours |
| `RateLimitError` | 429, carries `retryAfter`, `limit` and `remaining` |
| `ServerError` | 5xx |
| `TimeoutError` | a request or a polling loop ran out of time |
| `ConnectionError` | the request never reached the API |
| `JobFailedError` | a queued lookup or batch ended in a failed state |

Rate limits, server errors and network failures are retried automatically with exponential backoff,
honoring `Retry-After`. Validation and auth failures are never retried.

## Configuration

```ts
const client = new ProductMapper({
    apiKey: process.env.PRODUCTMAPPER_API_KEY,
    baseUrl: 'https://product-mapper.com',   // override for a self-hosted instance
    timeout: 30_000,                         // per request, in milliseconds
    maxRetries: 2,                           // for 429, 5xx and network errors
    headers: { 'X-Team': 'pricing' },        // sent with every request
    fetch: customFetch                       // a proxy, or a stub in tests
});
```

Any call accepts an `AbortSignal`, which cancels the request and any polling it started:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
await client.lookup({ value: '079361039905', signal: controller.signal });
```

## API reference

| Method | Description |
| --- | --- |
| `lookup(options)` | Resolve one identifier. Polls a queued lookup unless `poll: false` |
| `lookupMany(items, options?)` | Submit up to 500 identifiers as a batch job |
| `getJob(jobId)` | Poll one queued single lookup |
| `getJobs(jobIds)` | Poll up to 100 queued lookups in one round trip |
| `getBatch(batchId)` | Fetch a batch job and its items |
| `getBatchCsv(batchId)` | Export a batch job as CSV |
| `waitForJob(jobId, options?)` | Poll a queued lookup until it resolves |
| `waitForBatch(batchId, options?)` | Poll a batch until every item is processed |
| `history(options?)` | List lookup history, 25 per page |
| `historyAll(options?)` | Async iterator over every history row |
| `deleteHistoryRow(rowId)` | Delete one history row |
| `clearHistory()` | Clear the entire history |

### Supported values

**Identifier types:** `auto`, `UPC`, `EAN`, `GTIN`, `ASIN`, `Title`

**Regions:** `US`, `CA`, `MX`, `BR`, `UK`, `DE`, `FR`, `IT`, `ES`, `NL`, `PL`, `SE`, `IN`, `JP`, `AU`, `SG`

Both are exported as `IDENTIFIER_TYPES` and `REGIONS`.

## Examples

Runnable scripts live in [examples/](./examples): single lookup, batch with progress and CSV export,
history paging, and full error handling.

## Links

- [ProductMapper](https://product-mapper.com)
- [API documentation](https://product-mapper.com/docs)
- [MCP server for AI agents](https://product-mapper.com/docs/api-mcp)
- [Python SDK](https://github.com/siktec-lab/product-mapper-py)
- [Report an issue](https://github.com/siktec-lab/product-mapper-ts/issues)

## License

MIT, see [LICENSE](./LICENSE).
