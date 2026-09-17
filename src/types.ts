/**
 * Type definitions mirroring the ProductMapper REST API contract.
 *
 * These shapes follow the published OpenAPI schema. Nullable fields are genuinely null
 * when Amazon does not report that data point for a listing, never a fabricated placeholder.
 */

/** Identifier kinds the API accepts. "auto" lets the server infer from the value shape. */
export type IdentifierType = 'auto' | 'UPC' | 'EAN' | 'GTIN' | 'ASIN' | 'Title';

/** Identifier kinds the API returns (never "auto"). */
export type ResolvedIdentifierType = 'UPC' | 'EAN' | 'GTIN' | 'ASIN' | 'Title';

/** Amazon marketplace regions a lookup can be scoped to. */
export type Region =
    | 'US'
    | 'CA'
    | 'MX'
    | 'BR'
    | 'UK'
    | 'DE'
    | 'FR'
    | 'IT'
    | 'ES'
    | 'NL'
    | 'PL'
    | 'SE'
    | 'IN'
    | 'JP'
    | 'AU'
    | 'SG';

/** Every supported region, handy for validation and menus. */
export const REGIONS: readonly Region[] = [
    'US',
    'CA',
    'MX',
    'BR',
    'UK',
    'DE',
    'FR',
    'IT',
    'ES',
    'NL',
    'PL',
    'SE',
    'IN',
    'JP',
    'AU',
    'SG'
] as const;

/** Every supported identifier type. */
export const IDENTIFIER_TYPES: readonly IdentifierType[] = [
    'auto',
    'UPC',
    'EAN',
    'GTIN',
    'ASIN',
    'Title'
] as const;

/** Secondary identifiers Amazon reports for a listing. Absent when a provider does not expose them. */
export interface ListingIdentifiers {
    upc?: string;
    ean?: string;
    gtin?: string;
    asin?: string;
}

/** The full product and pricing data resolved for a matched Amazon listing. */
export interface AmazonListing {
    asin: string;
    title: string;
    brand: string;
    manufacturer?: string;
    description?: string;
    imageUrl: string;
    price: number | null;
    formattedPrice: string | null;
    listPrice: number | null;
    offerCount: number | null;
    offerCountFba: number | null;
    offerCountMerchant: number | null;
    isBuyBoxWinner: boolean | null;
    salesRank: number | null;
    /** The more specific of the two classification levels a provider exposes. */
    category?: string;
    /** The broader top-level department. Same as category when only one level exists. */
    categoryGroup?: string;
    packageQuantity?: number;
    link: string;
    isActive: boolean;
    identifiers?: ListingIdentifiers;
    /**
     * The internal Amazon marketplace id (for example ATVPDKIKX0DER for US). Distinct from
     * MappingResult.marketplaceId, which holds the matched product ASIN.
     */
    marketplaceId?: string;
    /** Display label for marketplaceId, for example "US" or "CA". */
    marketplaceLabel?: string;
    [key: string]: unknown;
}

/** A resolved single lookup. */
export interface MappingResult {
    identifierType: ResolvedIdentifierType;
    identifierValue: string;
    marketplace: string;
    /**
     * The matched product ASIN, despite the name. See listingDetails.marketplaceId for
     * the internal Amazon marketplace identifier.
     */
    marketplaceId: string | null;
    /** Amazon marketplace country this result matched in. Null for not-found or legacy rows. */
    amazonMarketplaceLabel?: string | null;
    /** Unix epoch milliseconds. */
    timestamp: number;
    listingDetails?: AmazonListing;
    /**
     * Only present when no region filter was given and the identifier matched in more than one
     * Amazon marketplace region. The top-level fields always mirror results[0].
     */
    results?: MappingResult[];
    [key: string]: unknown;
}

/** Status of one item inside a batch job. */
export type BatchItemStatus = 'pending' | 'completed' | 'not_found' | 'error';

/**
 * One row of a batch job. Batch rows carry fewer fields than AmazonListing: no link,
 * isActive, category, categoryGroup, identifiers, listPrice, offerCountFba, offerCountMerchant
 * or isBuyBoxWinner. Look an identifier up individually with lookup() if you need those.
 */
export interface BatchItem {
    id: string;
    identifierType: string;
    identifierValue: string;
    marketplaceId: string | null;
    title: string | null;
    brand: string | null;
    price: number | null;
    formattedPrice: string | null;
    salesRank: number | null;
    offerCount: number | null;
    imageUrl: string | null;
    status: BatchItemStatus;
    errorMessage?: string;
    [key: string]: unknown;
}

/** Status of a whole batch job. */
export type BatchJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** A batch job and, once processing has started, its items. */
export interface BatchJob {
    id: string;
    userId: string;
    orgId: string | null;
    marketplace: string;
    totalItems: number;
    processedItems: number;
    matchedItems: number;
    status: BatchJobStatus;
    createdAt: string;
    updatedAt: string;
    /** Only present once processing has started. */
    items?: BatchItem[];
    [key: string]: unknown;
}

/** A single-lookup job that is still resolving. */
export interface JobProcessing {
    status: 'processing';
    message?: string;
}

/** A single-lookup job that finished successfully. */
export interface JobCompleted {
    status: 'completed';
    data: MappingResult;
}

/** A single-lookup job that failed. */
export interface JobFailed {
    status: 'failed';
    error: string;
}

/** Any state a polled single-lookup job can be in. */
export type JobStatus = JobProcessing | JobCompleted | JobFailed;

/** Returned by lookup() with polling disabled, when the server is still resolving. */
export interface QueuedLookup {
    status: 'processing';
    message?: string;
    jobId: string;
}

/** One row of your lookup history. */
export interface HistoryRow {
    id: string;
    identifierType: string;
    identifierValue: string;
    marketplace: string;
    marketplaceId: string | null;
    title: string | null;
    brand: string | null;
    price: number | null;
    formattedPrice: string | null;
    imageUrl: string | null;
    /**
     * Live-verified values are "success" and "not_found". Note that history rows use a
     * different vocabulary than batch items, which report "completed" for a match.
     */
    status: string;
    createdAt: string;
    /** How many times you have looked up this exact identifier. */
    seenCount?: number;
    lastSeenAt?: string;
    listingDetails?: AmazonListing;
    [key: string]: unknown;
}

/** A page of lookup history. */
export interface HistoryPage {
    history: HistoryRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

/** Options for a single lookup. */
export interface LookupOptions {
    /** The identifier or title to resolve. Required. */
    value: string;
    /** Identifier kind. Defaults to "auto", letting the server infer it. */
    type?: IdentifierType;
    /** Marketplace to search. Defaults to "amazon". */
    marketplace?: string;
    /** Restrict the search to one Amazon marketplace country. */
    region?: Region;
    /**
     * When the server needs more than 8 seconds it returns a job instead of a result.
     * By default the client polls that job until it resolves. Set false to get the
     * QueuedLookup handle back immediately and poll it yourself.
     */
    poll?: boolean;
    /** How long to keep polling a queued lookup, in milliseconds. Defaults to 120000. */
    pollTimeout?: number;
    /** Delay between polls, in milliseconds. Defaults to 1500. */
    pollInterval?: number;
    /** Abort signal forwarded to the underlying request. */
    signal?: AbortSignal;
}

/** Options for submitting a batch job. */
export interface BatchOptions {
    /** Marketplace to search. Defaults to "amazon". */
    marketplace?: string;
    /** Abort signal forwarded to the underlying request. */
    signal?: AbortSignal;
}

/** Options for listing history. */
export interface HistoryOptions {
    /** 1-based page number. Defaults to 1. */
    page?: number;
    /** Matches identifier value or product title, case-insensitive and partial. */
    search?: string;
    /** Abort signal forwarded to the underlying request. */
    signal?: AbortSignal;
}

/** Options for waiting on a queued single lookup. */
export interface WaitJobOptions {
    /** Give up after this many milliseconds. Defaults to 120000. */
    timeout?: number;
    /** Delay between polls, in milliseconds. Defaults to 1500. */
    interval?: number;
    /** Abort signal forwarded to the underlying requests. */
    signal?: AbortSignal;
}

/** Options for waiting on a batch job. */
export interface WaitBatchOptions {
    /** Give up after this many milliseconds. Defaults to 600000. */
    timeout?: number;
    /** Delay between polls, in milliseconds. Defaults to 3000. */
    interval?: number;
    /** Called after every poll, useful for progress reporting. */
    onProgress?: (job: BatchJob) => void;
    /** Abort signal forwarded to the underlying requests. */
    signal?: AbortSignal;
}

/** Client configuration. */
export interface ProductMapperOptions {
    /** Your API key, generated at https://product-mapper.com/dashboard/api-keys. */
    apiKey: string;
    /** Override the API origin. Defaults to https://product-mapper.com. */
    baseUrl?: string;
    /** Per-request timeout in milliseconds. Defaults to 30000. */
    timeout?: number;
    /** Retry attempts for rate limits, server errors and network failures. Defaults to 2. */
    maxRetries?: number;
    /** Extra headers sent with every request. */
    headers?: Record<string, string>;
    /** Swap in a custom fetch implementation, for tests or proxies. */
    fetch?: typeof globalThis.fetch;
}
