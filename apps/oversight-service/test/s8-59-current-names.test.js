import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES } from 'ccms-shared';
import { fetchReport, listReports } from '../src/modules/reports/reports.js';
import { withCurrentPublisherNames } from '../src/modules/reports/current-names.js';
const row = { report_id: '00000000-0000-4000-8000-000000000001', office_id: 'o', published_by: 'a', published_by_name: 'Stored mock', status: 'PUBLISHED', figures: {} };
test('report list and published/superseded detail resolve names while preserving role restrictions', async () => {
  const original = { url: process.env.IDENTITY_URL, key: process.env.SERVICE_KEY, fetch: globalThis.fetch };
  process.env.IDENTITY_URL = 'https://identity.test/api'; process.env.SERVICE_KEY = 'test-key';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://identity.test/api/internal/accounts/a');
    assert.equal(options.headers['x-service-key'], 'test-key');
    return Response.json({ full_name: 'Current mock' });
  };
  const db = { query: async (sql) => sql.includes('count(*)') ? [{ total: 1 }] : [row] };
  try {
    for (const status of ['PUBLISHED', 'SUPERSEDED']) {
      row.status = status;
      assert.equal((await fetchReport(db, { role: ROLES.SUPER_ADMIN }, row.report_id)).published_by_name, 'Current mock');
    }
    assert.equal((await listReports(db, { role: ROLES.SUPER_ADMIN }, new URLSearchParams())).items[0].published_by_name, 'Current mock');
    for (const role of [ROLES.EXECUTIVE, ROLES.OFFICE_STAFF]) {
      const report = await fetchReport(db, { role, officeId: 'o' }, row.report_id);
      assert.equal(Object.hasOwn(report, 'published_by_name'), false);
      assert.equal(Object.hasOwn(report, 'published_by'), false);
    }
    assert.equal(row.published_by_name, 'Stored mock');
  } finally {
    globalThis.fetch = original.fetch;
    for (const [key, value] of [['IDENTITY_URL', original.url], ['SERVICE_KEY', original.key]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('report names fall back on missing accounts and Identity outages', async () => {
  const rows = [row, { report_id: 'restricted' }];
  const env = { IDENTITY_URL: 'https://identity.test', SERVICE_KEY: 'test-key' };
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => Response.json({})]) {
    assert.deepEqual(await withCurrentPublisherNames(rows, { env, fetchImpl }), rows);
  }
});
