/**
 * Resolve one identifier into an Amazon listing.
 *
 * Run with: PRODUCTMAPPER_API_KEY=pm_live_... npx tsx examples/single-lookup.ts
 */
import { ProductMapper, NotFoundError, CreditsExhaustedError } from '../src/index.js';

const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY as string });

async function main() {
    try {
        const result = await client.lookup({ value: '079361039905', type: 'UPC' });
        const listing = result.listingDetails;

        console.log('ASIN:      ', result.marketplaceId);
        console.log('Title:     ', listing?.title);
        console.log('Brand:     ', listing?.brand);
        console.log('Price:     ', listing?.formattedPrice ?? 'not reported');
        console.log('Sales rank:', listing?.salesRank ?? 'not reported');
        console.log('Region:    ', result.amazonMarketplaceLabel);
        console.log('Link:      ', listing?.link);
    } catch (error) {
        if (error instanceof NotFoundError) {
            console.error('No match in the Amazon catalog for that identifier.');
            return;
        }
        if (error instanceof CreditsExhaustedError) {
            console.error('Out of credits. Top up at https://product-mapper.com/dashboard/billing');
            return;
        }
        throw error;
    }
}

main();
