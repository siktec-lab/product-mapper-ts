/**
 * Single source of truth for the package version.
 *
 * `__PACKAGE_VERSION__` is replaced at build time by tsup, reading package.json, so the
 * version is declared in exactly one place. The `typeof` guard keeps the source runnable
 * outside that build (vitest, ts-node, a direct tsc compile), where no replacement happens.
 */
declare const __PACKAGE_VERSION__: string | undefined;

export const VERSION: string =
    typeof __PACKAGE_VERSION__ === 'string' ? __PACKAGE_VERSION__ : '0.0.0-dev';
