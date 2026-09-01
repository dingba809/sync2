import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist-server/index.js',
  external: ['better-sqlite3'],
  sourcemap: false
});
console.log('server bundled');
