// testToolchain.mjs
// Guards the one thing that silently rots: the Node version claimed in the docs
// agents read, versus the Node version CI actually installs.
//
// This repo once ran 9 workflows on Node 24 and 5 on Node 20 while AGENTS.md
// said "Node 24" and README-AGENTS.md said "Node 18+". A script using a
// 24-only API passes in price-refresh and fails in self-heal — and self-heal is
// the job meant to catch failures. package.json engines is the single source of
// truth; everything else must agree with it.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const DOCS = ['AGENTS.md', 'README-AGENTS.md'];

const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

const declared = pkg.engines?.node;
assert.ok(declared, 'package.json must declare engines.node (the source of truth)');

const expected = Number(declared.match(/(\d+)/)?.[1]);
assert.ok(Number.isInteger(expected), `could not parse a major version from engines.node "${declared}"`);

// Every workflow must install the declared major.
const workflows = (await fs.readdir(WORKFLOW_DIR)).filter((f) => /\.ya?ml$/.test(f));
assert.ok(workflows.length > 0, 'no workflows found to check');

const mismatched = [];
for (const file of workflows) {
  const body = await fs.readFile(path.join(WORKFLOW_DIR, file), 'utf8');
  for (const [, version] of body.matchAll(/node-version:\s*['"]?(\d+)/g)) {
    if (Number(version) !== expected) mismatched.push(`${file}: node-version ${version}`);
  }
}
assert.deepEqual(
  mismatched,
  [],
  `workflows disagree with engines.node (${expected}):\n  ${mismatched.join('\n  ')}`,
);

// Docs agents read must not claim a different Node version.
const staleDocs = [];
for (const file of DOCS) {
  const body = await fs.readFile(path.join(ROOT, file), 'utf8');
  for (const [match, version] of body.matchAll(/Node (\d+)/g)) {
    if (Number(version) !== expected) staleDocs.push(`${file}: "${match}"`);
  }
}
assert.deepEqual(
  staleDocs,
  [],
  `docs claim a Node version other than engines.node (${expected}):\n  ${staleDocs.join('\n  ')}`,
);

console.log(`Toolchain tests passed (Node ${expected}, ${workflows.length} workflows, ${DOCS.length} docs).`);
