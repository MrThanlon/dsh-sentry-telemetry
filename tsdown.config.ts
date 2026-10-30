import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { name: string }

const PACKAGE_ID = manifest.name

const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
])

const HOST_EXTERNALS = new Set([
  '@deepseek-ai/cordis',
])

export default defineConfig([
  {
    name: `${PACKAGE_ID}/host`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    define: {
      __SENTRY_DEBUG__: 'false',
    },
    deps: {
      onlyBundle: false,
      neverBundle: (id: string) => isBuiltin(id) || HOST_EXTERNALS.has(id),
      alwaysBundle: (id: string) => !isBuiltin(id) && !HOST_EXTERNALS.has(id),
    },
  },
  {
    name: `${PACKAGE_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __SENTRY_DEBUG__: 'false',
    },
    deps: {
      onlyBundle: false,
      neverBundle: (id: string) => CLIENT_EXTERNALS.has(id),
      alwaysBundle: (id: string) => !CLIENT_EXTERNALS.has(id),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: () => `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
