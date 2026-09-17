/**
 * Page through your lookup history, and search it.
 *
 * Run with: PRODUCTMAPPER_API_KEY=pm_live_... npx tsx examples/history.ts
 */
import { ProductMapper } from '../src/index.js';

const client = new ProductMapper({ apiKey: process.env.PRODUCTMAPPER_API_KEY as string });

async function main() {
    const firstPage = await client.history({ page: 1 });
    console.log(`${firstPage.total} rows across ${firstPage.totalPages} pages\n`);

    for (const row of firstPage.history) {
        console.log(`  ${row.createdAt}  ${row.identifierValue.padEnd(20)} ${row.title ?? row.status}`);
    }

    const matches = await client.history({ search: 'coffee' });
    console.log(`\n${matches.total} rows match "coffee"`);

    // historyAll walks every page for you, one row at a time.
    let counted = 0;
    for await (const _row of client.historyAll()) counted += 1;
    console.log(`Walked ${counted} rows in total`);
}

main();
