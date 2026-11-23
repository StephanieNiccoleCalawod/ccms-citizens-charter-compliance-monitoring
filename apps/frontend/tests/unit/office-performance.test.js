import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertMetrics, barLabel, buildOfficePerformanceModel, filterOfficeServices } from '../../src/lib/ui/office-performance.js';

const offices = [
  { office_id: 'o1', office_name: 'OSDS', office_code: 'OSDS' },
  { office_id: 'o2', office_name: 'Registrar', office_code: 'REG' },
  { office_id: 'o3', office_name: 'Library', office_code: 'LIB' },
  { office_id: 'o4', office_name: 'Archived', is_active: false },
];
const names = { offices: { o1: 'OSDS', o2: 'Registrar', o3: 'Library' }, services: { s1: 'Scholarship', s2: 'ID Card', s3: 'Transcript', s4: 'Clearance' } };
const overview = {
  min_cell_completed: 5,
  heatmap: [
    { office_id: 'o1', service_id: 's1', service_code: 'S1', completed: 10, late: 5, late_rate: 50 },
    { office_id: 'o1', service_id: 's2', service_code: 'S2', completed: 20, late: 0, late_rate: 0 },
    { office_id: 'o2', service_id: 's3', service_code: 'S3', completed: 10, late: 2, late_rate: 20 },
    { office_id: 'o2', service_id: 's4', service_code: 'S4', completed: 2, late: 2, late_rate: 100, too_few: true },
  ],
  charter: { services: [{ office_id: 'o1', service_id: 's1', limit_minutes: 960, p90_minutes: 1200 }] },
};

test('office totals are the sums of real counts and the worst service sets the office status', () => {
  const model = buildOfficePerformanceModel({ overview, offices, names });
  const osds = model.offices.find((o) => o.office_id === 'o1');
  assert.equal(osds.completed, 30);
  assert.equal(osds.late, 5);
  assert.equal(osds.on_time, 25);
  assert.equal(osds.status.key, 'delayed');
  assert.equal(model.offices.find((o) => o.office_id === 'o2').status.key, 'attention');
  assert.equal(model.offices.find((o) => o.office_id === 'o3').status.key, 'no_data');
  assert.equal(model.offices.some((o) => o.office_id === 'o4'), false, 'inactive offices are left out');
  assert.equal(model.offices[0].office_id, 'o1', 'the worst office comes first');
});

test('services use the existing thresholds: over 20% delayed, over 10% needs attention, under 5 completed too few', () => {
  const { services } = buildOfficePerformanceModel({ overview, offices, names });
  const status = (id) => services.find((s) => s.service_id === id).status.key;
  assert.equal(status('s1'), 'delayed');
  assert.equal(status('s2'), 'on_time');
  assert.equal(status('s3'), 'attention');
  assert.equal(status('s4'), 'too_few');
});

test('alerts hold only delayed and needs-attention services, worst first, with the Charter limit and overrun', () => {
  const { attention } = buildOfficePerformanceModel({ overview, offices, names });
  assert.deepEqual(attention.map((s) => s.service_id), ['s1', 's3']);
  const m = alertMetrics(attention[0]);
  assert.equal(m.lateLine, '50% Late (5 of 10)');
  assert.equal(m.limitLine, '16 h 0 min');
  assert.match(m.overLine, /4 h 0 min past the limit/);
  assert.equal(attention[1].limit_text, 'Not recorded');
});

test('an office-scoped user only sees their own office', () => {
  const model = buildOfficePerformanceModel({ overview, offices, names, scope: { kind: 'office', officeId: 'o2' } });
  assert.deepEqual(model.offices.map((o) => o.office_id), ['o2']);
  assert.ok(model.services.every((s) => s.office_id === 'o2'));
});

test('filters and search', () => {
  const { services } = buildOfficePerformanceModel({ overview, offices, names });
  assert.deepEqual(filterOfficeServices(services, 'delayed').map((s) => s.service_id).sort(), ['s1', 's3']);
  assert.deepEqual(filterOfficeServices(services, 'on_time').map((s) => s.service_id), ['s2']);
  assert.deepEqual(filterOfficeServices(services, 'all', 'transcr').map((s) => s.service_id), ['s3']);
  assert.deepEqual(filterOfficeServices(services, 'all', 's4').map((s) => s.service_id), ['s4']);
});

test('bar labels state the real figures', () => {
  assert.match(barLabel({ completed: 10, late: 3 }), /7 on time and 3 late of 10 completed \(30% late\)/);
  assert.match(barLabel({ completed: 0, late: 0 }), /No completed/);
});

test('catalogue services with no completed transactions are listed per office', () => {
  const catalogue = [
    { service_id: 's1', office_id: 'o1', service_name: 'Scholarship', service_code: 'S1' },
    { service_id: 'x1', office_id: 'o1', service_name: 'Zeta Service', service_code: 'X1' },
    { service_id: 'x2', office_id: 'o1', service_name: 'Alpha Service', service_code: 'X2' },
    { service_id: 'x3', office_id: 'o1', service_name: 'Inactive', is_active: false },
    { service_id: 'x4', office_id: 'o2', service_name: 'Other office' },
  ];
  const model = buildOfficePerformanceModel({ overview, offices, services: catalogue, names });
  assert.deepEqual(model.offices.find((o) => o.office_id === 'o1').no_activity.map((s) => s.service_name), ['Alpha Service', 'Zeta Service']);
  assert.deepEqual(model.offices.find((o) => o.office_id === 'o2').no_activity.map((s) => s.service_name), ['Other office']);
});

test('an office with activity that is not in the office list is shown as unknown, with a short piece of its ID', () => {
  const orphan = { ...overview, heatmap: [...overview.heatmap, { office_id: '2b696c02-5adc-43d5-8977-a2818ed94552', service_id: 's9', service_code: 'S9', completed: 1, late: 1, late_rate: 100, too_few: true }] };
  const model = buildOfficePerformanceModel({ overview: orphan, offices, names });
  const unknown = model.offices.find((o) => o.office_id === '2b696c02-5adc-43d5-8977-a2818ed94552');
  assert.equal(unknown.office_name, 'Unknown office');
  assert.equal(unknown.office_code, 'ID 2b696c02');
  assert.deepEqual([unknown.on_time, unknown.late], [0, 1]);
  assert.equal(model.offices.find((o) => o.office_id === 'o1').office_code, 'OSDS', 'a known office keeps its own code');
});
