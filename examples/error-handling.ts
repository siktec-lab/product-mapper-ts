/**
 * Every error this client raises, and how to react to each one.
 *
 * Run with: PRODUCTMAPPER_API_KEY=pm_live_... npx tsx examples/error-handling.ts
 */
import {
    ProductMapper,
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
} from '../src/index.js';

const client = new ProductMapper({
    apiKey: process.env.PRODUCTMAPPER_API_KEY as string,
    // Rate limits, 5xx responses and network blips are retried automatically.
    maxRetries: 3,
    timeout: 20_000
});

async function main() {
    try {
        const result = await client.lookup({ value: '079361039905', type: 'UPC', region: 'US' });
        console.log('Matched:', result.listingDetails?.title);
    } catch (error) {
        if (error instanceof ValidationError) {
            console.error('The request was rejected:', error.message);
        } else if (error instanceof AuthenticationError) {
            console.error('Check PRODUCTMAPPER_API_KEY, it was rejected.');
        } else if (error instanceof CreditsExhaustedError) {
            console.error('Out of credits. Upgrade or buy a credit pack.');
        } else if (error instanceof PermissionError) {
            console.error('No active organization selected for this key.');
        } else if (error instanceof NotFoundError) {
            console.error('No match in the Amazon catalog.');
        } else if (error instanceof RateLimitError) {
            console.error(`Rate limited. Retry after ${error.retryAfter}s (limit ${error.limit}/min).`);
        } else if (error instanceof JobFailedError) {
            console.error(`Job ${error.jobId} failed:`, error.message);
        } else if (error instanceof TimeoutError) {
            console.error('The request took too long.');
        } else if (error instanceof ConnectionError) {
            console.error('Could not reach the API.');
        } else if (error instanceof ServerError) {
            console.error('The API failed to handle the request:', error.status);
        } else if (error instanceof ProductMapperError) {
            // Base class, so one catch can cover everything above.
            console.error(`Unexpected API error ${error.status}:`, error.message);
        } else {
            throw error;
        }
    }
}

main();
