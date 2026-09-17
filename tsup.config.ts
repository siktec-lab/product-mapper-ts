import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

// The version is declared once, in package.json, and injected at build time. Nothing in
// src/ hardcodes it, so a release cannot ship a User-Agent that disagrees with the
// published version. See src/version.ts for the declaration this replaces.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    target: 'es2022',
    define: {
        __PACKAGE_VERSION__: JSON.stringify(version)
    }
});
