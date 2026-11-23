// S8-38: the accessibility fixes the audit found stay in place. (Checklist: docs/accessibility-checklist-S8-38.md.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', 'src', p), 'utf8');

function ratio(a, b) {
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('muted text keeps 4.5:1 on the page background and secondary text on the grey pills', () => {
  const css = read('app/globals.css');
  const page = css.match(/--color-page:\s*(#[0-9A-F]{6})/i)[1];
  assert.ok(ratio('#64748B', page) >= 4.5, `muted on ${page}`);
  assert.ok(ratio('#475569', '#F4F5F8') >= 4.5);
  assert.ok(ratio('#475569', '#F8F5F0') >= 4.5, 'field labels on the public cream');
});

test('no grey pill pairs the muted text with the pill background', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const bad = walk(path.join(__dirname, '..', '..', 'src')).filter((f) => /['"`][^'"`\r\n]*bg-\[#F4F5F8\][^'"`\r\n]*text-\[#64748B\]|['"`][^'"`\r\n]*text-\[#64748B\][^'"`\r\n]*bg-\[#F4F5F8\]/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('shared link style and the small links keep a 24 px target', () => {
  assert.match(read('app/globals.css'), /@utility btn-link \{[^}]*min-h-6/);
  for (const f of ['components/layout/PublicHeader.js', 'components/dashboard/DashboardHeader.js', 'components/dashboard/LateRiskPanel.js', 'components/public/PublicDirectory.js']) assert.ok(read(f).includes('min-h-6'), f);
});

test('a tab panel that can take focus shows where the focus is', () => {
  assert.match(read('app/globals.css'), /\[role="tabpanel"\]:focus-visible\s*\{[^}]*outline/);
});

test('the account menu name starts with what the button shows', () => {
  const shell = read('components/layout/AppShell.js');
  assert.ok(shell.includes('Account menu for ${user.fullName} ${ROLE_LABELS[user.role]}'));
});

test('S8-41: a queue reply that is not a board shows the retry message instead of crashing the page', () => {
  const q = read('components/queue/QueuePanel.js');
  assert.ok(q.includes('!Array.isArray(data.waiting)') && q.includes('The queue could not be loaded. It will try again shortly.'));
});

test('S8-41: the service directory has one top-level heading', () => {
  assert.ok(read('components/public/PublicDirectory.js').includes('<h1 id="directory-heading"'));
});

test('S8-12 #3: the Reports and Complaints office filters say when an office is inactive', () => {
  for (const f of ['components/reports/ReportsPage.js', 'components/complaints/ComplaintsPage.js']) {
    const s = read(f);
    assert.ok(s.includes('statusLabel(o.office_name, o)'), f);
    assert.ok(!s.includes('>{o.office_name}</option>'), f + ' still lists offices without their status');
  }
});

test('S8-17: no receipt form on a cancelled transaction, long tickets wrap, unnamed staff are explained', () => {
  assert.ok(read('components/transactions/TransactionDetail.js').includes("canAttach={tx.status !== 'CANCELLED'}"));
  const receipt = read('components/transactions/ReceiptPanel.js');
  assert.ok(receipt.includes('canAttach = true') && receipt.includes('so no receipt can be attached'));
  const queue = read('components/queue/QueuePanel.js');
  assert.equal((queue.match(/min-w-0 break-all font-sans text-(2xl|sm) font-bold tabular-nums/g) || []).length, 3);
  const home = read('components/home/KpiHome.js');
  assert.ok(home.includes('hasUnnamedStaff(rows)') && home.includes('data-testid="staff-names-note"'));
});
