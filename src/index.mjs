export const TOOL_ID = 'release-notes-diff';
export const LIMITS = Object.freeze({ bytes: 1_048_576, records: 100, depth: 4, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({
  'input-unreadable': 'error', 'input-invalid': 'error', 'duplicate-key': 'error', 'byte-limit': 'error', 'depth-limit': 'error', 'record-limit': 'error', 'time-limit': 'error', 'export-incomplete': 'error',
  'commit-invalid': 'error', 'issue-invalid': 'error', 'note-invalid': 'error', 'identity-duplicate': 'error', 'no-commits': 'error', 'revert-unresolved': 'error', 'issue-context-missing': 'error', 'category-conflict': 'error',
  'note-omitted': 'error', 'unsupported-claim': 'error', 'category-mismatch': 'error'
});
const UNKNOWN = new Set(['input-unreadable', 'input-invalid', 'duplicate-key', 'byte-limit', 'depth-limit', 'record-limit', 'time-limit', 'export-incomplete', 'commit-invalid', 'issue-invalid', 'note-invalid', 'identity-duplicate', 'no-commits', 'revert-unresolved', 'issue-context-missing', 'category-conflict']);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(v);
const category = v => ['feature', 'fix', 'security', 'docs', 'internal'].includes(v);
function finding(ruleId, pointer = '') {
  if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule');
  return { ruleId, severity: RULE_SEVERITY[ruleId], message: {
    'note-omitted': 'An active user-facing change with issue context has no release note.',
    'unsupported-claim': 'A release note names no active committed change.',
    'category-mismatch': 'The release-note category disagrees with the committed change.',
    'issue-context-missing': 'Issue context needed to evaluate this user-facing change is absent.',
    'category-conflict': 'Issue and commit categories conflict; note content cannot be inferred.',
    'revert-unresolved': 'A revert does not unambiguously reference an earlier change commit.'
  }[ruleId] ?? 'Release evidence cannot be evaluated safely.', location: { file: '@export', pointer } };
}
function report(findings, checked = 0) {
  findings.sort((a, b) => order(a.location.file, b.location.file) || order(a.location.pointer, b.location.pointer) || order(a.ruleId, b.ruleId));
  const errors = findings.filter(f => f.severity === 'error').length;
  return { schemaVersion: '1', tool: TOOL_ID, status: findings.some(f => UNKNOWN.has(f.ruleId)) ? 'incomplete' : errors ? 'fail' : 'pass', summary: { checked, errors, warnings: 0 }, findings };
}
export const incomplete = ruleId => report([finding(ruleId)]);
export function parseStrictJson(raw) {
  const value = JSON.parse(raw); let i = 0;
  const space = () => { while (/\s/u.test(raw[i] ?? '')) i++; };
  const token = () => { const start = i++; while (i < raw.length) { if (raw[i] === '\\') { i += 2; continue; } if (raw[i++] === '"') return JSON.parse(raw.slice(start, i)); } throw new Error('input-invalid'); };
  const walk = depth => { if (depth > LIMITS.depth) throw new Error('depth-limit'); space(); if (raw[i] === '{') { i++; space(); const keys = new Set(); while (raw[i] !== '}') { const key = token(); if (keys.has(key)) throw new Error('duplicate-key'); keys.add(key); space(); i++; walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '[') { i++; space(); while (raw[i] !== ']') { walk(depth + 1); space(); if (raw[i] !== ',') break; i++; space(); } i++; return; } if (raw[i] === '"') { token(); return; } while (i < raw.length && !/[\s,}\]]/u.test(raw[i])) i++; };
  walk(0); return value;
}
function tooDeep(v, depth = 0) { return depth > LIMITS.depth || (v !== null && typeof v === 'object' && Object.values(v).some(child => tooDeep(child, depth + 1))); }
function exportItems(v) { return object(v) && v.complete === true && Array.isArray(v.items) && Object.keys(v).every(k => ['complete', 'items'].includes(k)); }
export function compareReleaseNotes(document, { now = Date.now } = {}) {
  const start = now(), expired = () => now() - start > LIMITS.milliseconds;
  if (!object(document)) return incomplete('input-invalid');
  let bytes; try { bytes = Buffer.byteLength(JSON.stringify(document)); } catch { return incomplete('input-invalid'); }
  if (bytes > LIMITS.bytes) return incomplete('byte-limit');
  if (tooDeep(document)) return incomplete('depth-limit');
  if (expired()) return incomplete('time-limit');
  if (document.schemaVersion !== '1' || !object(document.commits) || !object(document.issues) || !object(document.notes) || Object.keys(document).some(k => !['schemaVersion', 'complete', 'commits', 'issues', 'notes'].includes(k))) return incomplete('input-invalid');
  if (document.complete !== true || [document.commits, document.issues, document.notes].some(x => x.complete !== true)) return incomplete('export-incomplete');
  if (![document.commits, document.issues, document.notes].every(exportItems)) return incomplete('input-invalid');
  if ([document.commits, document.issues, document.notes].some(x => x.items.length > LIMITS.records)) return incomplete('record-limit');
  if (!document.commits.items.length) return incomplete('no-commits');
  const commits = new Map(), changes = new Map(), reverted = new Set(), issues = new Map(), notes = new Map();
  for (const [i, commit] of document.commits.items.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!object(commit) || !id(commit.id) || !['change', 'revert'].includes(commit.kind) || (commit.kind === 'change' && (!id(commit.changeId) || !category(commit.category) || typeof commit.userFacing !== 'boolean' || (commit.details !== undefined && typeof commit.details !== 'string') || Object.keys(commit).some(k => !['id', 'kind', 'changeId', 'category', 'userFacing', 'details'].includes(k)))) || (commit.kind === 'revert' && (!id(commit.reverts) || Object.keys(commit).some(k => !['id', 'kind', 'reverts'].includes(k))))) return report([finding('commit-invalid', `/commits/items/${i}`)]);
    if (commits.has(commit.id) || commit.kind === 'change' && changes.has(commit.changeId)) return report([finding('identity-duplicate', `/commits/items/${i}`)]);
    if (commit.kind === 'revert') {
      const target = commits.get(commit.reverts);
      if (!target || target.commit.kind !== 'change' || reverted.has(commit.reverts)) return report([finding('revert-unresolved', `/commits/items/${i}/reverts`)]);
      reverted.add(commit.reverts);
    } else changes.set(commit.changeId, { commit, ordinal: i });
    commits.set(commit.id, { commit, ordinal: i });
  }
  for (const [i, issue] of document.issues.items.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!object(issue) || !id(issue.changeId) || !category(issue.category) || Object.keys(issue).some(k => !['changeId', 'category'].includes(k))) return report([finding('issue-invalid', `/issues/items/${i}`)]);
    if (issues.has(issue.changeId)) return report([finding('identity-duplicate', `/issues/items/${i}`)]);
    issues.set(issue.changeId, { issue, ordinal: i });
  }
  for (const [i, note] of document.notes.items.entries()) {
    if (expired()) return incomplete('time-limit');
    if (!object(note) || !id(note.changeId) || !category(note.category) || Object.keys(note).some(k => !['changeId', 'category'].includes(k))) return report([finding('note-invalid', `/notes/items/${i}`)]);
    if (notes.has(note.changeId)) return report([finding('identity-duplicate', `/notes/items/${i}`)]);
    notes.set(note.changeId, { note, ordinal: i });
  }
  const findings = [];
  for (const [changeId, { commit, ordinal }] of changes) {
    if (expired()) return incomplete('time-limit');
    if (reverted.has(commit.id)) continue;
    const context = issues.get(changeId);
    if (!context && (commit.userFacing || notes.has(changeId))) { findings.push(finding('issue-context-missing', `/commits/items/${ordinal}`)); continue; }
    if (context && context.issue.category !== commit.category) { findings.push(finding('category-conflict', `/issues/items/${context.ordinal}`)); continue; }
    if (commit.userFacing && !notes.has(changeId)) findings.push(finding('note-omitted', `/commits/items/${ordinal}`));
  }
  for (const [changeId, { note, ordinal }] of notes) {
    if (expired()) return incomplete('time-limit');
    const entry = changes.get(changeId);
    if (!entry || reverted.has(entry.commit.id)) { findings.push(finding('unsupported-claim', `/notes/items/${ordinal}`)); continue; }
    if (!issues.has(changeId)) continue;
    if (entry.commit.category !== note.category) findings.push(finding('category-mismatch', `/notes/items/${ordinal}`));
  }
  if (expired()) return incomplete('time-limit');
  return report(findings, document.commits.items.length);
}
