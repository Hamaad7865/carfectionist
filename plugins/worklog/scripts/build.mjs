/**
 * Build the browser half into the loader format the Harness page expects.
 *
 * The compiled module is wrapped in `__ModuleLoader__.load()` and receives the
 * page's shared React through the factory's `require` argument, so no React copy
 * is bundled. esbuild resolves from the repository's own node_modules.
 */
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'client.js');

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/entry.jsx'],
  outfile: join(root, 'src', '.client.bundle.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['chrome120'],
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'warning',
  write: false,
});

const code = result.outputFiles[0].text;
if (/^\s*export\s+/m.test(code) || /^\s*import\s+/m.test(code)) {
  throw new Error('Compiled bundle still contains ESM syntax.');
}

const output = `window.__ModuleLoader__.load({
  id: '@local/worklog',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${code}
    return module.exports;
  },
});
`;

await writeFile(outfile, output, 'utf8');
const written = await readFile(outfile, 'utf8');
console.log(`Built ${outfile} (${(written.length / 1024).toFixed(1)} KiB)`);
