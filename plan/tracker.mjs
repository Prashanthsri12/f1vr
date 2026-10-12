#!/usr/bin/env node
// Update BUILD_TRACKER.md item statuses and recompute the summary table.
// Usage: node plan/tracker.mjs <status> <id...> [--note "text"]
//   status: todo | wip | done | blocked | skip
//   e.g.   node plan/tracker.mjs done 1.2 1.3 --note "see tests/api.test.js"
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FILE = fileURLToPath(new URL('./BUILD_TRACKER.md', import.meta.url));
const ICONS = { todo: '⬜', wip: '🟡', done: '✅', blocked: '⛔', skip: '⏭️' };
const ANY = '(⬜|🟡|✅|⛔|⏭️)';

const args = process.argv.slice(2);
const noteIdx = args.indexOf('--note');
const note = noteIdx >= 0 ? args.splice(noteIdx, 2)[1] : undefined;
const [status, ...ids] = args;
if (!ICONS[status] || ids.length === 0) {
  console.error('usage: node plan/tracker.mjs <todo|wip|done|blocked|skip> <id...> [--note "text"]');
  process.exit(1);
}

let s = readFileSync(FILE, 'utf8');
for (const id of ids) {
  const re = new RegExp(`^(\\| ${id.replace('.', '\\.')} \\|.*?\\| )${ANY}( \\|)(.*\\|)$`, 'm');
  if (!re.test(s)) { console.error(`item ${id} not found`); process.exit(1); }
  s = s.replace(re, (_, pre, _old, sep, rest) => pre + ICONS[status] + sep + (note !== undefined ? ` ${note} |` : rest));
}

// Recompute the summary table from the per-phase tables.
for (let p = 0; p <= 7; p++) {
  const rows = [...s.matchAll(new RegExp(`^\\| ${p}\\.\\d+ \\|.*?\\| ${ANY} \\|.*\\|$`, 'gm'))].map(m => m[1]);
  if (!rows.length) continue;
  const done = rows.filter(x => x === '✅' || x === '⏭️').length;
  const icon = done === rows.length ? '✅' : rows.some(x => x !== '⬜') ? '🟡' : '⬜';
  s = s.replace(new RegExp(`^(\\| ${p} \\| [^|]+\\| )${ANY} \\| \\d+ / \\d+ \\|$`, 'm'), `$1${icon} | ${done} / ${rows.length} |`);
}
writeFileSync(FILE, s);
console.log(`${ICONS[status]} ${ids.join(', ')}`);
