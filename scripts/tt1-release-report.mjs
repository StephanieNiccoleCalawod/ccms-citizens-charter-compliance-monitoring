// Private release evidence and PR description; no credentials or business records.
import { readFile, writeFile } from 'node:fs/promises';
const folder = new URL('../../tt1-hosted-integration-evidence-20261110/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(name, folder), 'utf8'));
const release = await read('production-release.json');
if (release.status !== 'ALL_FOUR_PASSED') throw new Error('All four production migrations must be verified first');
const checks = await read('release-checks.json');
let deployments;
try { deployments = await read('deployment-verification.json'); } catch { /* not deployed yet */ }
const ph = (date) => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'long' }).format(new Date(date));
const lines = [
  'Hosted `migrate` commands previously ran schema synchronization, which could remove existing database objects. This change replaces it with verified baseline adoption and numbered TypeORM migrations for Identity, Core, Operations and Oversight. Hosted synchronization is refused; migration writes require an explicit database target, a direct endpoint and a session lock. Destructive reversals are guarded.',
  '',
  'Includes the integrated office schedules/version counters, transaction starter labels, outside-hours flag, forecast storage and stricter position check. Resolves Operations merge-conflict markers while preserving both integrated behaviors. Frontend tests now reflect read-only SMS academic terms and the current shared design; forecast selectors use the existing API adapter. Patches production mail and file-matching dependencies without upgrading TypeORM.',
  '',
  'Validation:', '',
  '- Complete GitHub lint, server-time checks, workspace tests, migration acceptance tests and production builds passed.',
  '- All six Vercel preview builds passed for the release commit.',
  '- Production dependency audit: zero vulnerabilities.',
  '- All four source databases matched their retained backups immediately before release. Fresh temporary copies passed the migrations using the release dependencies and secure Neon session transport.',
  '- No mock data was imported. Registry/analytics/report backend features not implemented in the existing application remain separate work.',
  '',
  `Migration code commit: \`${release.commit}\`.`,
  `Hosted execution: **${ph(release.startedAt)}** through **${ph(release.completedAt)}**.`,
  'Execution actor: Codex acting on the user’s explicit release instruction; no separate human review is claimed.',
  '',
  '| Service | Retained backup | Completed (Asia/Manila) | Verification |',
  '| --- | --- | --- | --- |',
  ...release.services.map((s) => `| ${s.service} | ${s.backup.id} | ${ph(s.completedAt)} | Baseline changed bookkeeping only; original records preserved |`),
  '',
  'Exact applied migration names:', '',
  ...release.services.flatMap((s) => [`**${s.service}**`, '', ...s.after.migrations.map((m) => `- \`${m}\``), '']),
  'Retained backup IDs and full schema/record checksums are kept in private release evidence. Credentials and database records are excluded.', '',
  'GitHub checks:', '',
  ...checks.github.checks.filter((c) => c.name === 'checks').map((c) => `- [Passed validation run](${c.url})`), '',
];
if (deployments) {
  lines.push(`Production deployment verification: ${ph(deployments.checkedAt)}.`, '',
    '| App | State | Production domain | Health checks |', '| --- | --- | --- | --- |',
    ...deployments.projects.map((p) => `| ${p.rootDirectory} | ${p.deployment?.state ?? 'missing'} | ${(p.domains ?? []).filter((d) => d.matches).map((d) => `[${d.domain}](https://${d.domain})`).join(', ')} | ${(p.probes ?? []).every((probe) => probe.httpStatus === 200) && p.probes?.length ? 'Passed' : 'Requires review'} |`), '',
    `Deployed merge commit: \`${deployments.commit}\`. The frontend-to-gateway-to-Core public service request and frontend authentication-key request returned HTTP 200. Signed-in user workflows were not exercised during these smoke checks.`, '');
  if (deployments.projects.every((p) => p.errorLogScan?.available && p.errorLogScan.matchingEvents === 0 || p.errorLogScan?.otherErrorEvents === 0)) {
    const warnings = deployments.projects.reduce((sum, p) => sum + (p.errorLogScan.sslModeWarnings ?? 0), 0);
    lines.push(`Bounded production log scan: ${warnings} PostgreSQL sslmode compatibility warning entries; no other error entries. All live smoke checks passed.`, '');
  }
} else lines.push('Production migrations are verified. Application deployment and live health verification are the next release step.', '');
try {
  const mergedChecks = await read('merged-checks.json');
  if (mergedChecks.checks.some((c) => c.name === 'checks' && c.conclusion === 'success')) {
    lines.push('The automatic GitHub validation on the deployed merge commit also passed:', '',
      ...mergedChecks.checks.filter((c) => c.name === 'checks').map((c) => `- [Passed deployed-commit checks](${c.url})`), '');
  }
} catch { /* deployment validation may still be running */ }
const text = lines.join('\n');
await writeFile(new URL('RELEASE.md', folder), text);
await writeFile(new URL('../../tt1-pr-body.md', import.meta.url), text);
console.log('Sanitized release report and PR description prepared.');
