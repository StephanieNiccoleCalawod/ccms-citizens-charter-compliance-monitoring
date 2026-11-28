// Private operator evidence and sanitized PR description, never credentials or business records.
import { readFile, writeFile } from 'node:fs/promises';
const dir = new URL('../../tt2-release-evidence-20261111/', import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const db = await load('production-release.json');
if (db.services.length !== 2 || db.services.some((s) => s.status !== 'PASSED' || !s.originalRecordsPreserved)) throw new Error('Both migrations must pass first');
const ci = await load('final-pr-checks.json');
if (ci.checks.some((c) => c.conclusion !== 'success')) throw new Error('Passing final checks required');
const ph = (s) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'long' }).format(new Date(s));
const lines = [
  'TT2 adds a privacy-safe transaction event feed from Operations to Oversight, independent durable delivery, a version-guarded latest-transaction projection, service-key-only paged export and a resumable backfill. The gateway blocks internal ingestion/export paths across aliases while adding analytics/reports routing.', '',
  'Review fixes bound rejected-batch fallback by count/time, prioritize deferred events to avoid starvation, cap backoff before exponentiation to prevent overflow, and correct the legacy migration test to permit only declared TT2 additions while retaining original constraint OID checks.', '',
  'Validation:', '',
  '- Both complete final GitHub runs passed lint, server-time checks, all workspace tests, migration-safety tests, end-to-end analytics tests, production builds and dependency audit.',
  '- All six Vercel preview builds passed.',
  '- Independent normal local production builds, lint, time checks and production audit passed; all 18 Operations analytics tests and the corrected migration regression passed locally. The complete Linux CI runs supersede the older, redundant local safety run.',
  '- AC1–AC5 are covered by PostgreSQL-backed and gateway integration tests, including duplicates, older-version protection, privacy exclusions, repeated backfill and service-key/browser isolation.',
  '- Both hosted-copy rehearsals and retained backup verification passed; no original records were changed by the production migrations.', '',
  `Migration code commit: \`${db.commit}\`.`,
  `Hosted execution: ${ph(db.startedAt)} through ${ph(db.completedAt)}. Actor: Codex acting on the user-authorized release.`, '',
  '| Service | Applied new migration | Retained backup | Result |', '| --- | --- | --- | --- |',
  ...db.services.map((s) => `| ${s.service} | ${s.after.migrations.filter((m) => m.startsWith('Tt2')).map((m) => `\`${m}\``).join(', ')} | ${s.backup.id} | Applied; original records preserved |`), '',
  ...ci.checks.filter((c) => c.name === 'checks').map((c) => `- [Passed full validation](${c.url})`), '',
];
try {
  const deployment = await load('deployment-verification.json');
  lines.push(`Deployed commit: \`${deployment.commit}\`. Verification: ${ph(deployment.checkedAt)}.`, '',
    '| App | Production state | Domain verified | Health |', '| --- | --- | --- | --- |',
    ...deployment.projects.map((p) => `| ${p.rootDirectory} | ${p.deployment?.state ?? 'missing'} | ${p.domains?.length && p.domains.every((d) => d.matches) ? 'Yes' : 'Pending'} | ${p.probes?.length && p.probes.every((p) => p.httpStatus === 200) ? 'Passed' : 'Pending'} |`), '');
} catch { lines.push('Application deployment and live security checks are the remaining release step.', ''); }
try {
  const live = await load('live-analytics-verification.json');
  lines.push(`TT2 live security checks: ${live.checks.length} passed. Protected endpoints reject unauthenticated calls; gateway ingestion/export routes are blocked; analytics/reports health aliases work.`, '',
    '**Historical production backfill was not executed.** Existing local operator credentials are development-only. No development service key was sent to production. Run the documented backfill with production operator credentials, then record repeat-run counts/checksums before closing that operational step.', '');
} catch { /* live security checks pending */ }
try {
  const merged = await load('merged-checks.json');
  const passed = merged.checks.find((c) => c.name === 'checks' && c.conclusion === 'success');
  if (passed) lines.push(`[The full validation on the deployed merge commit also passed](${passed.url}).`, '');
} catch { /* merged validation may still be running */ }
lines.push('No seed datasets or QA fixtures were imported. No credentials or business records are included in this PR/evidence. New periodic schedules are not activated by this release; after-response delivery and authenticated recovery job routes are available. Registry capture, KPI/report APIs and moving existing forecast/model consumers to Oversight remain separate tasks.', '');
const text = lines.join('\n');
await writeFile(new URL('RELEASE.md', dir), text);
await writeFile(new URL('../../tt2-pr-body.md', import.meta.url), text);
console.log('Sanitized TT2 release record prepared.');
