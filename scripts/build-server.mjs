import { rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist/server', { recursive: true, force: true });

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server/index.js',
  packages: 'external',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
});
