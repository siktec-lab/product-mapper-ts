/**
 * Submit a batch of identifiers, follow its progress, then export the results as CSV.
 *
 * Run with: PRODUCTMAPPER_API_KEY=pm_live_... npx tsx examples/batch-lookup.ts
 */
import { writeFile } from 'node:fs/promises';
import { ProductMapper } from '../src/index.js';

const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY as string });

async function main() {
    const identifiers = ['079361039905', 'B004U9VVX6', '0885909950805', 'Logitech MX Master 3S'];

    const job = await client.lookupMany(identifiers);
    console.log(`Submitted batch ${job.id} with ${job.totalItems} items`);

    const finished = await client.waitForBatch(job.id, {
        onProgress: (j) => console.log(`  ${j.processedItems}/${j.totalItems} processed`)
    });

    console.log(`\nMatched ${finished.matchedItems} of ${finished.totalItems}\n`);
    for (const item of finished.items ?? []) {
        const label = item.title ?? item.status;
        console.log(`  ${item.identifierValue.padEnd(24)} ${label}`);
    }

    const csv = await client.getBatchCsv(job.id);
    await writeFile('batch-results.csv', csv, 'utf8');
    console.log('\nSaved batch-results.csv');
}

main();
