/**
 * Verifies the built package actually works on Node 18, the oldest runtime the
 * engines field claims to support. The dev toolchain (vitest) needs Node 20+, so the
 * main suite cannot run here. This exercises the real dist output instead: both module
 * formats load, the client constructs, a request is issued with the right headers, and
 * a typed error is thrown for a failed response.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const esm = await import('../dist/index.js');
const cjs = require('../dist/index.cjs');

for (const [label, mod] of [
    ['esm', esm],
    ['cjs', cjs]
]) {
    assert.equal(typeof mod.ProductMapper, 'function', `${label}: ProductMapper missing`);
    assert.equal(typeof mod.NotFoundError, 'function', `${label}: NotFoundError missing`);
    assert.ok(Array.isArray(mod.REGIONS) && mod.REGIONS.includes('US'), `${label}: REGIONS bad`);
    assert.equal(mod.DEFAULT_BASE_URL, 'https://product-mapper.com', `${label}: base url bad`);
}

const { ProductMapper, NotFoundError, ValidationError } = esm;

// An api key is required.
assert.throws(() => new ProductMapper({ apiKey: '' }), ValidationError);

// A successful lookup parses, and sends the expected auth header.
let seen = null;
const okClient = new ProductMapper({
    apiKey: 'pm_live_smoke',
    maxRetries: 0,
    fetch: async (url, init) => {
        seen = { url: String(url), headers: init.headers };
        return new Response(
            JSON.stringify({
                identifierType: 'UPC',
                identifierValue: '753933140816',
                marketplace: 'amazon',
                marketplaceId: 'B09Z2J1MP2',
                timestamp: 1,
                listingDetails: { asin: 'B09Z2J1MP2', title: 'Smoke', brand: 'B', price: 1.5 }
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    }
});

const result = await okClient.lookup({ value: '753933140816', type: 'UPC' });
assert.equal(result.marketplaceId, 'B09Z2J1MP2');

// The build injects the package.json version, so the shipped User-Agent must carry a
// real version, never the dev placeholder from src/version.ts.
const pkg = require('../package.json');
assert.equal(
    seen.headers['User-Agent'],
    `productmapper-node/${pkg.version}`,
    'built User-Agent must match package.json version'
);
assert.equal(result.listingDetails.price, 1.5);
assert.equal(seen.url, 'https://product-mapper.com/api/map');
assert.equal(seen.headers.Authorization, 'Bearer pm_live_smoke');

// A 404 maps to the typed error.
const failClient = new ProductMapper({
    apiKey: 'pm_live_smoke',
    maxRetries: 0,
    fetch: async () =>
        new Response(JSON.stringify({ error: 'no match' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        })
});

await assert.rejects(() => failClient.lookup({ value: 'x' }), NotFoundError);

console.log(`Node ${process.version}: dist ESM + CJS smoke test passed.`);
