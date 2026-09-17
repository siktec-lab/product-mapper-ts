/**
 * Official TypeScript client for the ProductMapper API.
 *
 * @see https://product-mapper.com/docs
 */
export { ProductMapper } from './client.js';
export { DEFAULT_BASE_URL } from './http.js';

export {
    ProductMapperError,
    ValidationError,
    AuthenticationError,
    PermissionError,
    CreditsExhaustedError,
    NotFoundError,
    RateLimitError,
    ServerError,
    TimeoutError,
    ConnectionError,
    JobFailedError
} from './errors.js';

export { REGIONS, IDENTIFIER_TYPES } from './types.js';

export type {
    IdentifierType,
    ResolvedIdentifierType,
    Region,
    ListingIdentifiers,
    AmazonListing,
    MappingResult,
    BatchItem,
    BatchItemStatus,
    BatchJob,
    BatchJobStatus,
    JobProcessing,
    JobCompleted,
    JobFailed,
    JobStatus,
    QueuedLookup,
    HistoryRow,
    HistoryPage,
    LookupOptions,
    BatchOptions,
    HistoryOptions,
    WaitJobOptions,
    WaitBatchOptions,
    ProductMapperOptions
} from './types.js';
