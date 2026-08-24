/**
 * Vercel compiles api/*.ts to ESM and rewrites nothing: an extensionless
 * relative import survives into the deployed .js, where Node's ESM resolver
 * rejects it and the function dies on load with ERR_MODULE_NOT_FOUND. The
 * browser sees a 500 in plain text, which is easy to misread as "no API here".
 *
 * So every relative import reachable from api/ must carry an explicit .js
 * extension and point at a file that exists. Run as part of the build so a
 * function that cannot load fails the deploy instead of shipping.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const IMPORT = /\bfrom\s+['"](\.[^'"]*)['"]|\bimport\s*\(\s*['"](\.[^'"]*)['"]/g;

const seen = new Set();
const problems = [];

function check(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(IMPORT)) {
    const spec = match[1] ?? match[2];
    const where = relative(root, file);
    if (!/\.(js|mjs|json)$/.test(spec)) {
      problems.push(`${where}: '${spec}' needs an explicit .js extension`);
      continue;
    }
    const base = resolve(dirname(file), spec);
    const target = [base.replace(/\.js$/, '.ts'), base].find(existsSync);
    if (!target) problems.push(`${where}: '${spec}' does not resolve to a file`);
    else if (target.endsWith('.ts')) check(target);
  }
}

for (const name of readdirSync(resolve(root, 'api'))) {
  if (name.endsWith('.ts')) check(resolve(root, 'api', name));
}

if (problems.length) {
  console.error('Imports that would break a deployed function:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`api imports ok (${seen.size} files)`);
