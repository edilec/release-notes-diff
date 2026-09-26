import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareReleaseNotes, LIMITS, parseStrictJson } from '../src/index.mjs';

const change = (id = 'c1', changeId = 'CH-1', category = 'feature', userFacing = true) => ({ id, kind: 'change', changeId, category, userFacing });
const issue = (changeId = 'CH-1', category = 'feature') => ({ changeId, category });
const note = (changeId = 'CH-1', category = 'feature') => ({ changeId, category });
const doc = (commits = [change()], issues = [issue()], notes = [note()]) => ({ schemaVersion: '1', complete: true, commits: { complete: true, items: commits }, issues: { complete: true, items: issues }, notes: { complete: true, items: notes } });
const run = (root, input) => spawnSync(process.execPath, ['bin/release-notes-diff.mjs', '--root', root, '--input', input], { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '--import=/Users/km/Desktop/web/open-source/migration-plan-template/support/deny-network.mjs' } });

test('explicit supported user-facing change and note pass', () => {
  const r = compareReleaseNotes(doc()); assert.equal(r.status, 'pass'); assert.equal(r.summary.checked, 1); assert.deepEqual(r.findings, []);
});
test('omitted user-facing change fails at source commit ordinal', () => {
  const r = compareReleaseNotes(doc([change()], [issue()], [])); assert.equal(r.status, 'fail'); assert.equal(r.findings[0].ruleId, 'note-omitted'); assert.equal(r.findings[0].location.pointer, '/commits/items/0');
});
test('unsupported note claim and wrong category fail without exposing claim text', () => {
  const unsupported = compareReleaseNotes(doc([change()], [issue()], [note('CH-9')])); assert.equal(unsupported.status, 'fail'); assert.ok(unsupported.findings.some(f => f.ruleId === 'unsupported-claim')); assert.ok(!JSON.stringify(unsupported).includes('CH-9'));
  const mismatch = compareReleaseNotes(doc([change()], [issue()], [note('CH-1', 'fix')])); assert.equal(mismatch.status, 'fail'); assert.ok(mismatch.findings.some(f => f.ruleId === 'category-mismatch'));
});
test('referenced revert cancels original change; replacement must be explicit', () => {
  const revert = { id: 'c2', kind: 'revert', reverts: 'c1' };
  const canceled = compareReleaseNotes(doc([change(), revert], [issue()], [])); assert.equal(canceled.status, 'pass'); assert.deepEqual(canceled.findings, []);
  const unsupported = compareReleaseNotes(doc([change(), revert], [issue()], [note()])); assert.equal(unsupported.status, 'fail'); assert.equal(unsupported.findings[0].ruleId, 'unsupported-claim');
  const replacement = compareReleaseNotes(doc([change(), revert, change('c3', 'CH-2')], [issue(), issue('CH-2')], [note('CH-2')])); assert.equal(replacement.status, 'pass');
});
test('missing issue context and unresolvable revert remain incomplete, not fabricated', () => {
  assert.equal(compareReleaseNotes(doc([change()], [], [])).status, 'incomplete');
  assert.equal(compareReleaseNotes(doc([{ id: 'r1', kind: 'revert', reverts: 'missing' }], [], [])).status, 'incomplete');
  const partial = doc(); partial.issues.complete = false; assert.equal(compareReleaseNotes(partial).status, 'incomplete');
});
test('duplicate change and note identities never pass', () => {
  assert.equal(compareReleaseNotes(doc([change(), change('c2')], [issue()], [note()])).status, 'incomplete');
  assert.equal(compareReleaseNotes(doc([change()], [issue()], [note(), note()])).status, 'incomplete');
});
test('commit, issue and note counts accept N, reject N+1', () => {
  const commits = Array.from({ length: LIMITS.records }, (_, i) => change(`c${i}`, `CH-${i}`, 'internal', false));
  const c = doc([...commits], [], []); assert.equal(compareReleaseNotes(c).status, 'pass'); c.commits.items.push(change('extra', 'EXTRA', 'internal', false)); assert.equal(compareReleaseNotes(c).findings[0].ruleId, 'record-limit');
  const issues = Array.from({ length: LIMITS.records }, (_, i) => issue(`CH-${i}`, 'internal'));
  const i = doc(commits, [...issues], []); assert.equal(compareReleaseNotes(i).status, 'pass'); i.issues.items.push(issue('EXTRA', 'internal')); assert.equal(compareReleaseNotes(i).findings[0].ruleId, 'record-limit');
  const notes = Array.from({ length: LIMITS.records }, (_, i) => note(`CH-${i}`, 'internal'));
  const n = doc(commits, issues, notes); assert.equal(compareReleaseNotes(n).status, 'pass'); n.notes.items.push(note('EXTRA', 'internal')); assert.equal(compareReleaseNotes(n).findings[0].ruleId, 'record-limit');
});
test('byte, depth and injected time exact N pass, N+1 incomplete', () => {
  const x = doc(); x.commits.items[0].details = ''; const overhead = Buffer.byteLength(JSON.stringify(x)); x.commits.items[0].details = 'x'.repeat(LIMITS.bytes - overhead);
  assert.equal(compareReleaseNotes(x).status, 'pass'); x.commits.items[0].details += 'x'; assert.equal(compareReleaseNotes(x).findings[0].ruleId, 'byte-limit');
  const deep = doc(); assert.equal(compareReleaseNotes(deep).status, 'pass'); deep.commits.items[0].details = { nested: 'x' }; assert.equal(compareReleaseNotes(deep).findings[0].ruleId, 'depth-limit');
  assert.equal(compareReleaseNotes(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds : 0; })() }).status, 'pass');
  assert.equal(compareReleaseNotes(doc(), { now: (() => { let n=0; return () => n++ ? LIMITS.milliseconds + 1 : 0; })() }).findings[0].ruleId, 'time-limit');
});
test('duplicate JSON keys including escaped spelling refused', () => assert.throws(() => parseStrictJson('{"complete":false,"complet\\u0065":true}'), /duplicate-key/));
test('CLI realpath confinement, strict UTF-8 and usage stdout shape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notes-')); await writeFile(join(root, 'good.json'), JSON.stringify(doc())); assert.equal(run(root, 'good.json').status, 0);
  await writeFile(join(root, 'bad.json'), Buffer.from([0xff])); assert.equal(JSON.parse(run(root, 'bad.json').stdout).status, 'incomplete');
  await symlink(tmpdir(), join(root, 'escape')); const escaped = run(root, 'escape/nonexistent.json'); assert.equal(escaped.status, 2); assert.equal(JSON.parse(escaped.stdout).status, 'incomplete');
  const usage = spawnSync(process.execPath, ['bin/release-notes-diff.mjs', '--root', root, '--input', 'good.json', '--unknown'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }); assert.equal(usage.status, 2); assert.equal(usage.stdout, '');
});
