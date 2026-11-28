import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFmsMessage, CHANGE_KIND } from '../src/lib/calendar/message.js';

// Defaults to preparing evidence only. --send sends each negative test once.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--send')) throw new Error('Usage: node scripts/j15-schema-test.mjs [--send]');
const send = args.includes('--send');
const endpoint = 'https://planning.pupqc.tech/api/v1/planning/calendar-declarations';
const token = process.env.FMS_CALENDAR_TOKEN?.trim();
if (send && !token) throw new Error('FMS_CALENDAR_TOKEN is unavailable. No requests sent.');
const entityId = randomUUID();
const baseline = buildFmsMessage({
  messageId: randomUUID(),
  entry: {
    exception_id: entityId, revision: 1, exception_date: '2026-12-15',
    exception_type: 'SUSPENSION', applies_to: 'WORK', class_mode: null,
    description: 'FMS-TEST J15 Schema Handling', office_id: null,
    suspended_from: '08:00', suspended_until: '20:00', is_recurring: false,
  },
  date: '2026-12-15', changeKind: CHANGE_KIND.UPSERT,
  target: { termId: 'sms:pupqc:term:2026-1S', artifactRevision: 'ccms-fms-calendar-v3' },
  sourceTimestamp: new Date(),
});
const tests = [
  { name: 'unknown-optional-field', payload: { ...structuredClone(baseline), messageId: randomUUID(), j15OptionalNote: 'FMS-TEST J15 optional field' } },
  { name: 'unsupported-major-version', payload: { ...structuredClone(baseline), messageId: randomUUID(), schemaVersion: 4 } },
];
const report = {
  createdAt: new Date().toISOString(), mode: send ? 'LIVE' : 'PREPARED_ONLY', endpoint,
  entityId, baseline, expected: { httpStatus: 400, code: 'INVALID_REQUEST', stateChange: false },
  acceptance: 'PENDING_FMS_VERIFICATION',
  tests: tests.map((test) => ({ ...test, deliveryState: 'NOT_SENT' })),
};
const directory = resolve('j15-evidence', entityId);
await mkdir(directory, { recursive: true });
const file = resolve(directory, 'evidence.json');
const redact = (text) => token ? text.split(token).join('[REDACTED]') : text;
const save = () => writeFile(file, redact(JSON.stringify(report, null, 2)), { mode: 0o600 });
await save();
if (send) {
  for (const test of report.tests) {
    test.sentAt = new Date().toISOString();
    test.deliveryState = 'ATTEMPT_STARTED';
    await save();
    try {
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(test.payload),
      });
      test.httpStatus = response.status;
      test.responseBody = redact(await response.text());
      test.deliveryState = 'HTTP_RESPONSE_RECEIVED';
      test.completedAt = new Date().toISOString();
      let body;
      try { body = JSON.parse(test.responseBody); } catch { body = null; }
      test.expectedHttpResponse = response.status === 400 && (body?.code === 'INVALID_REQUEST' || body?.error?.code === 'INVALID_REQUEST');
      console.log(`${test.name}: HTTP ${response.status}`);
      await save();
      if (!test.expectedHttpResponse) {
        process.exitCode = 1;
        console.log('Unexpected response. Stopping; check with FMS before continuing.');
        break;
      }
    } catch (error) {
      test.deliveryState = 'UNKNOWN';
      test.error = redact(String(error.message));
      await save();
      process.exitCode = 1;
      break;
    }
  }
}
console.log(JSON.stringify({ mode: report.mode, entityId, evidence: file, messageIds: report.tests.map((test) => test.payload.messageId) }, null, 2));
console.log('FMS must verify no declaration row, receipt or class change. No automatic retries.');
