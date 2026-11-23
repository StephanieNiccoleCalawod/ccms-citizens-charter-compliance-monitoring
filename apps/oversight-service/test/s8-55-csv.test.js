import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BOM, cell, reportCsvFilename, reportToCsv } from '../src/modules/reports/csv.js';

test('S8-55 filename uses office name, Manila generation date and a safe filing name', () => {
  const name = reportCsvFilename({ office_name: 'Office of Student Affairs', generated_at: '2026-11-23T16:01:00Z' });
  assert.equal(name, 'CCCMS_Report_Office_of_Student_Affairs_11242026.csv');
  const unsafe = reportCsvFilename({ office_name: '../../École\r\n"Bad', generated_at: '2026-11-24T03:00:00Z' });
  assert.equal(unsafe, 'CCCMS_Report_Ecole_Bad_11242026.csv');
  assert.doesNotMatch(unsafe, /[\r\n"/\\]/);
});
test('S8-55 CSV bytes have a real UTF-8 BOM, one plain header, service names and US dates', () => {
  const csv = reportToCsv({ office_name: 'École', from: '2026-11-01', to: '2026-11-30', period_type: 'monthly',
    figures: { services: [{ service_code: 'HIDDEN-CODE', service_name: 'Résumé, request', received: 2 }], total: { received: 2 } } });
  assert.deepEqual([...new TextEncoder().encode(csv).slice(0, 3)], [239, 187, 191]);
  assert.equal(BOM.codePointAt(0), 0xfeff);
  assert.match(csv, /11\/01\/2026,11\/30\/2026/);
  assert.match(csv, /"Résumé, request"/);
  assert.doesNotMatch(csv, /HIDDEN-CODE/);
  assert.equal(csv.split('Office,Period,From,To').length - 1, 1);
});
test('S8-55 text formula injection is neutralized even after leading whitespace', () => {
  for (const value of ['=1+1', '  =1+1', '\t@SUM(A1)', '\uFEFF+1']) assert.ok(cell(value).startsWith("'"));
  assert.equal(cell(-12), '-12');
});
