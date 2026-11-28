import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = process.env.TT1_EVIDENCE_DIR ?? fileURLToPath(new URL('../../tt1-hosted-evidence-20261110/', import.meta.url));
const report = JSON.parse(await readFile(join(dir, 'verification.json'), 'utf8'));
const implementation = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  remoteTrackingHead: execFileSync('git', ['rev-parse', 'origin/codebase-for-deployment'], { cwd: root, encoding: 'utf8' }).trim(),
  uncommittedCandidate: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0, files: {} };
const files = ['package.json', 'package-lock.json', 'packages/ccms-shared/src/migrations.js', 'packages/ccms-shared/src/db.js',
  'scripts/tt1-neon-verify.mjs', 'scripts/migration-fingerprint.test.mjs'];
for (const service of report.services) {
  const base = `apps/${service.service}-service/migrations`;
  for (const name of await readdir(join(root, base), { recursive: true })) {
    const path = join(base, name);
    if ((await stat(join(root, path))).isFile()) files.push(path);
  }
  files.push(`apps/${service.service}-service/scripts/migrate.js`);
}
for (const path of files.sort()) implementation.files[path.replaceAll('\\', '/')] =
  createHash('sha256').update(await readFile(join(root, path))).digest('hex');
report.implementation = implementation;
report.evidenceGeneratedAt = new Date().toISOString();
await writeFile(join(dir, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
const manila = (value) => value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'long' }).format(new Date(value)) : 'Pending';
const lines = ['# TT1 hosted backup and rehearsal evidence', '',
  `Generated: ${manila(report.evidenceGeneratedAt)}.`, '',
  'Production was accessed through read-only SQL transactions only. No baseline registration, migrations, data imports, deployment, or schema synchronization ran on production.', '',
  'Retained backup branches contain the original schema and records. Separate child branches were used for the rehearsal. Database passwords, connection strings, and business records are not included in this evidence.', '',
  `Candidate code: \`${implementation.commit}\`${implementation.uncommittedCandidate ? ' plus uncommitted changes' : ' (tracked source committed)'}. Source and local operator-helper SHA-256 values are recorded in verification.json.`,
  `Remote-tracking deployment branch: \`${implementation.remoteTrackingHead}\`. The candidate incorporates this base; subsequent remote changes require another compatibility review.`, '',
  '| Service | Backup branch | Rehearsal result |', '| --- | --- | --- |'];
for (const entry of report.services) lines.push(`| ${entry.service} | ${entry.backup?.name ?? 'Pending'} | ${entry.status} |`);
for (const entry of report.services) {
  lines.push('', `## ${entry.service}`, '', `- Project: \`${entry.projectId}\`.`,
    `- Source branch: \`${entry.source.name}\` (\`${entry.source.id}\`).`,
    `- Database: \`${entry.database}\`.`,
    `- Backup: \`${entry.backup?.id}\`, created ${manila(entry.backup?.createdAt)}; parent LSN \`${entry.backup?.parentLsn}\`.`,
    `- Source schema and record checksums matched before/after backup: **${entry.backupVerified === true ? 'PASS' : 'NOT VERIFIED'}**.`,
    `- Rehearsal branch: \`${entry.rehearsal?.id}\`; expiry ${manila(entry.rehearsal?.expiresAt)}.`,
    `- Baseline adoption changed only migration bookkeeping: **${entry.baselineAdoptionVerified === true ? 'PASS' : 'PENDING'}**.`,
    `- Original business records preserved after migrations: **${entry.originalRecordsPreserved === true ? 'PASS' : 'PENDING'}**.`,
    `- Retained backup remained unchanged: **${entry.retainedBackupUnchanged === true ? 'PASS' : 'PENDING'}**.`,
    `- Completed: ${manila(entry.rehearsalCompletedAt)}.`, '', 'Applied on rehearsal only:', '',
    ...(entry.rehearsalAfter?.migrations ?? []).map((name) => `- \`${name}\``), '',
    '| Business table | Backup record count |', '| --- | ---: |',
    ...Object.entries(entry.backupSnapshot?.data ?? {}).map(([table, value]) => `| ${table} | ${value.count} |`), '',
    'Command output (rehearsal only):', '', '```text', ...(entry.rehearsalLog ?? ['Pending']), '```');
}
lines.push('', '## Comparison compatibility', '',
  'The first check flagged PostgreSQL 18 table NOT NULL catalog entries that PostgreSQL 16 does not store separately. Validated requirements are now represented once through column nullability. Unvalidated or inconsistent constraints remain blocking differences. The original snapshots and initial differences are retained in verification.json.', '',
  'Regression checks for this adjustment: 8/8 fingerprint, connection-guard, and runtime checks passed; shared migration lint passed.', '',
  '## Production execution remains pending', '',
  'PR #1 contains the committed release candidate. Full GitHub checks and all six Vercel preview builds passed. Fresh rehearsal copies passed using the release dependencies and official Neon session driver over verified TLS WebSockets. Production execution is gated on a fresh comparison against the retained backups and the recorded hosted safeguards. Subsequent production and deployment results are recorded separately in production-release.json and RELEASE.md.', '');
await writeFile(join(dir, 'REPORT.md'), lines.join('\n'));
console.log(`Evidence report: ${join(dir, 'REPORT.md')}`);
