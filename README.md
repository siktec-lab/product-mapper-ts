# ProductMapper Node.js SDK: UPC to ASIN Lookup API Client

[![npm version](https://img.shields.io/npm/v/@siktec-lab/productmapper.svg?logo=npm)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![npm downloads](https://img.shields.io/npm/dm/@siktec-lab/productmapper.svg)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![CI](https://github.com/siktec-lab/product-mapper-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/siktec-lab/product-mapper-ts/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Types](https://img.shields.io/npm/types/@siktec-lab/productmapper.svg)](https://www.npmjs.com/package/@siktec-lab/productmapper)
[![Node](https://img.shields.io/node/v/@siktec-lab/productmapper.svg?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@siktec-lab/productmapper)](https://bundlephobia.com/package/@siktec-lab/productmapper)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Official **Node.js and TypeScript client** for the [ProductMapper API](https://product-mapper.com).
Convert a **UPC, EAN, GTIN, ASIN or product title into live Amazon listing data**: price, sales rank
(BSR), offer counts, Buy Box status, brand, category and images, across 16 Amazon marketplaces.

Use it to build **barcode to ASIN lookup**, retail arbitrage tooling, competitor price monitoring,
catalog enrichment, and product data pipelines without hand-rolling HTTP calls or response types.

**[Website](https://product-mapper.com)** -
**[API Documentation](https://product-mapper.com/docs)** -
**[Get a Free API Key](https://product-mapper.com/dashboard/api-keys)** -
**[Python SDK](https://github.com/siktec-lab/product-mapper-py)**

## Contents

- [Why ProductMapper](#why-productmapper)
- [Install](#install)
- [Quick start](#quick-start)
- [Convert UPC to ASIN](#convert-upc-to-asin)
- [Bulk UPC to ASIN conversion](#bulk-upc-to-asin-conversion)
- [Lookup history](#lookup-history)
- [Error handling](#error-handling)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [FAQ](#faq)

## Why ProductMapper

| Feature | Detail |
| --- | --- |
| Identifier types | UPC, EAN, GTIN, ASIN, free-text title, or `auto` detection |
| Amazon marketplaces | 16 regions including US, CA, UK, DE, FR, IT, ES, JP, AU, IN |
| Batch size | Up to 500 identifiers per background job, with CSV export |
| Data returned | Price, list price, sales rank, offer counts, FBA/merchant split, Buy Box, brand, category, images |
| Typing | Full TypeScript definitions, ESM and CommonJS |
| Dependencies | Zero runtime dependencies |

## Install

```bash
npm install @siktec-lab/productmapper
```

```bash
pnpm add @siktec-lab/productmapper
# or
yarn add @siktec-lab/productmapper
# or
bun add @siktec-lab/productmapper
```

Requires Node 18 or newer. Ships ESM, CommonJS and full type declarations.

## Quick start

```ts
import { ProductMapper } from '@siktec-lab/productmapper';

const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY });

const result = await client.lookup({ value: '753933140816', type: 'UPC' });

console.log(result.marketplaceId);              // "B09Z2J1MP2" (the matched ASIN)
console.log(result.listingDetails?.title);      // "Husky Liners Weatherbeater Floor Mats"
console.log(result.listingDetails?.price);      // 80.99
console.log(result.listingDetails?.salesRank);  // 67364
```

Get a free API key at
[product-mapper.com/dashboard/api-keys](https://product-mapper.com/dashboard/api-keys). Keys look like
`pm_live_...` and belong in an environment variable, never in source control.

## Convert UPC to ASIN

`type` defaults to `auto`, so the server detects whether you passed a UPC, EAN, GTIN or ASIN.

```ts
await client.lookup({ value: '753933140816' });                      // auto-detected
await client.lookup({ value: '753933140816', type: 'UPC' });         // UPC to ASIN
await client.lookup({ value: '0885909950805', type: 'EAN' });        // EAN to ASIN
await client.lookup({ value: 'B09Z2J1MP2', type: 'ASIN' });          // ASIN lookup
await client.lookup({ value: 'Logitech MX Master 3S', type: 'Title' }); // title search
await client.lookup({ value: '753933140816', region: 'DE' });        // scope to one marketplace
```

Each successful mapping costs one credit. Without a `region`, an identifier that matches in several
Amazon marketplaces returns them all, and still costs a single credit:

```ts
const result = await client.lookup({ value: '753933140816' });

for (const match of result.results ?? [result]) {
    console.log(match.amazonMarketplaceLabel, match.listingDetails?.formattedPrice);
}
```

### Full listing fields

```ts
const listing = result.listingDetails;

listing?.asin;                 // "B09Z2J1MP2"
listing?.title;                // product title
listing?.brand;                // "Husky Liners"
listing?.price;                // 80.99
listing?.listPrice;            // 89.99
listing?.formattedPrice;       // "$80.99"
listing?.salesRank;            // 67364  (Best Sellers Rank)
listing?.offerCount;           // 5
listing?.offerCountFba;        // 1
listing?.offerCountMerchant;   // 4
listing?.isBuyBoxWinner;       // true
listing?.category;             // "Floor Mats"
listing?.categoryGroup;        // "Automotive Parts and Accessories"
listing?.imageUrl;             // product image
listing?.link;                 // Amazon product URL
```

### Slow lookups

If a lookup takes more than 8 seconds the API returns a job instead of a result. The client polls that
job automatically, so `lookup()` always resolves to a result. To manage polling yourself:

```ts
const queued = await client.lookup({ value: '753933140816', poll: false });

if (queued.status === 'processing') {
    const result = await client.waitForJob(queued.jobId);
}
```

## Bulk UPC to ASIN conversion

Submit up to 500 identifiers as one background job:

```ts
const job = await client.lookupMany(['753933140816', 'B09Z2J1MP2', 'Logitech MX Master 3S']);

const finished = await client.waitForBatch(job.id, {
    onProgress: (j) => console.log(`${j.processedItems}/${j.totalItems}`)
});

for (const item of finished.items ?? []) {
    console.log(item.identifierValue, item.title, item.price, item.status);
}
```

Export results as CSV, ready for Excel or Google Sheets:

```ts
import { writeFile } from 'node:fs/promises';

const csv = await client.getBatchCsv(job.id);
await writeFile('asin-results.csv', csv, 'utf8');
```

Batch rows carry fewer fields than a single lookup. Look an identifier up individually when you need
`link`, `category`, `identifiers` or the full offer breakdown.

## Lookup history

Every lookup is recorded, 25 rows per page.

```ts
const page = await client.history({ page: 1, search: 'husky' });
console.log(page.total, page.totalPages);

for await (const row of client.historyAll()) {
    console.log(row.identifierValue, row.title, row.status);
}

await client.deleteHistoryRow(rowId);
await client.clearHistory();
```

History rows report `status` as `success` or `not_found`, while batch items report `completed`.

## Error handling

Every failure is a `ProductMapperError`, so one catch can cover them all, with subclasses for the cases
worth handling individually.

```ts
import {
    ProductMapper,
    NotFoundError,
    RateLimitError,
    CreditsExhaustedError
} from '@siktec-lab/productmapper';

try {
    const result = await client.lookup({ value: '753933140816' });
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

| Error | HTTP | Raised when |
| --- | --- | --- |
| `ValidationError` | 400 | Bad arguments, rejected before or by the API |
| `AuthenticationError` | 401 | API key missing, malformed or revoked |
| `PermissionError` | 403 | No active organization selected |
| `CreditsExhaustedError` | 403 | Credit balance is empty |
| `NotFoundError` | 404 | No catalog match, or the resource is not yours |
| `RateLimitError` | 429 | Plan requests-per-minute exceeded |
| `ServerError` | 5xx | The API failed to handle the request |
| `TimeoutError` | - | A request or polling loop ran out of time |
| `ConnectionError` | - | The request never reached the API |
| `JobFailedError` | - | A queued lookup or batch ended in a failed state |

Rate limits, server errors and network failures are retried automatically with exponential backoff,
honoring `Retry-After`. Validation and auth failures are never retried.

## Configuration

```ts
const client = new ProductMapper({
    apiKey: process.env.PRODUCTMAPPER_API_KEY,
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
await client.lookup({ value: '753933140816', signal: controller.signal });
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

**Identifier types:** `auto`, `UPC`, `EAN`, `GTIN`, `ASIN`, `Title`

**Amazon marketplaces:** `US`, `CA`, `MX`, `BR`, `UK`, `DE`, `FR`, `IT`, `ES`, `NL`, `PL`, `SE`, `IN`,
`JP`, `AU`, `SG`

Both are exported as `IDENTIFIER_TYPES` and `REGIONS`.

## Examples

Runnable scripts live in [examples/](./examples): single lookup, batch with progress and CSV export,
history paging, and full error handling.

## FAQ

**How do I convert a UPC to an ASIN in Node.js?**
Install the package, create a client with your API key, and call
`client.lookup({ value: '<upc>', type: 'UPC' })`. The matched ASIN is `result.marketplaceId`.

**Can I look up many barcodes at once?**
Yes. `lookupMany()` accepts up to 500 identifiers per batch job, and `getBatchCsv()` exports results.

**Which Amazon marketplaces are supported?**
16 regions, listed above. Pass `region` to scope a lookup, or omit it to search across regions.

**Does it work with JavaScript as well as TypeScript?**
Yes. The package ships both ESM and CommonJS builds, with bundled type declarations for TypeScript.

**Is there a free plan?**
Yes, see [pricing](https://product-mapper.com/pricing).

**Is there a Python version?**
Yes, [productmapper on PyPI](https://pypi.org/project/productmapper/)
([source](https://github.com/siktec-lab/product-mapper-py)).

## Related

- [ProductMapper REST API documentation](https://product-mapper.com/docs)
- [MCP server for AI agents](https://product-mapper.com/docs/api-mcp)
- [Python SDK](https://github.com/siktec-lab/product-mapper-py)
- [Report an issue](https://github.com/siktec-lab/product-mapper-ts/issues)

## License

MIT, see [LICENSE](./LICENSE).
