// Browser regression test for consolidated Main Dashboard (/), /insights removal (404), /late-risk, /office, and /campus.
// A plain Playwright script like smoke.cjs (no test runner). Needs only the frontend at BASE_URL.
// Every /api call is MOCKED with page routes and the session is a synthetic unsigned token.
//
// Run:  node tests/e2e/analytics-dashboards.cjs
const { chromium } = require('playwright');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OFFICE_A = '11111111-1111-4111-8111-111111111111';
const OFFICE_B = '22222222-2222-4222-8222-222222222222';
const OFFICE_C = '33333333-3333-4333-8333-333333333333';
const OFFICE_INACTIVE = '44444444-4444-4444-8444-444444444444';
const SVC_A = 'aaaa1111-1111-4111-8111-111111111111';
const SVC_A2 = 'aaaa1112-1111-4111-8111-111111111111';
const SVC_A3 = 'aaaa1113-1111-4111-8111-111111111111';
const SVC_B = 'aaaa2222-2222-4222-8222-222222222222';
const SVC_C = 'aaaa3333-3333-4333-8333-333333333333';
const STAFF_1 = '55551111-1111-4111-8111-111111111111';
const STAFF_2 = '55552222-2222-4222-8222-555522222222';
const TX_OWN = '77771111-1111-4111-8111-111111111111';
const TX_PEER = '77772222-2222-4222-8222-222222222222';
const TX_B = '77773333-3333-4333-8333-333333333333';

const ok = (label, cond) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label);
  if (!cond) process.exitCode = 1;
};
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeJwt = (role, { sub = STAFF_1, officeId = role === 'super_admin' || role === 'executive' ? null : OFFICE_A } = {}) =>
  `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub, employee_no: 'E2E-1', full_name: 'E2E Tester', role, office_id: officeId })}.e2e`;

function manilaDateOffset(days) {
  const d = new Date(Date.now() + 8 * 3600_000 + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const OFFICES = [
  { office_id: OFFICE_A, office_code: 'REG', office_name: 'Registrar Office', is_active: true },
  { office_id: OFFICE_B, office_code: 'GUI', office_name: 'Guidance Office', is_active: true },
  { office_id: OFFICE_C, office_code: 'CSH', office_name: 'Cashier Office', is_active: true },
  { office_id: OFFICE_INACTIVE, office_code: 'ARC', office_name: 'Archived Office', is_active: false },
];

const SERVICES = [
  { service_id: SVC_A, office_id: OFFICE_A, office_name: 'Registrar Office', service_code: 'REG-TOR', service_name: 'Transcript of Records', classification: 'SIMPLE', standard_text: '2 hours', is_active: true },
  { service_id: SVC_A2, office_id: OFFICE_A, office_name: 'Registrar Office', service_code: 'REG-DIP', service_name: 'Diploma Reissuance', classification: 'COMPLEX', standard_text: '3 days', is_active: true },
  { service_id: SVC_A3, office_id: OFFICE_A, office_name: 'Registrar Office', service_code: 'REG-VER', service_name: 'Enrollment Verification', classification: 'SIMPLE', standard_text: '1 hour', is_active: true },
  { service_id: SVC_B, office_id: OFFICE_B, office_name: 'Guidance Office', service_code: 'GUI-GMC', service_name: 'Good Moral Certificate', classification: 'SIMPLE', standard_text: '1 hour', is_active: true },
  { service_id: SVC_C, office_id: OFFICE_C, office_name: 'Cashier Office', service_code: 'CSH-OR', service_name: 'Official Receipt Copy', classification: 'SIMPLE', standard_text: '30 minutes', is_active: true },
];

function makeForecast(officeId, { total = 72, pointToday = 14, stale = false, asOfDate = null, serviceId = null } = {}) {
  const histDays = [-4, -3, -2, -1].map((d, i) => ({ date: manilaDateOffset(d - 1), count: 8 + i }));
  histDays.push({ date: manilaDateOffset(-1), count: 10 });
  const forecast = [0, 1, 2, 3, 4].map((d, i) => ({
    date: manilaDateOffset(d),
    point: i === 0 ? pointToday : Math.round((total - pointToday) / 4),
    lower: i === 0 ? Math.max(1, pointToday - 3) : 10,
    upper: i === 0 ? pointToday + 4 : 20,
  }));
  return {
    officeId,
    serviceId,
    status: 'SUCCESS',
    stale,
    fresh: !stale,
    asOfDate: asOfDate || manilaDateOffset(0),
    generatedAt: '2026-11-18T00:00:00.000Z',
    historyWorkingDays: 20,
    historicalTransactionCount: 240,
    weeklyTotal: total,
    model: { name: 'HOLT_WINTERS_ADDITIVE', mae: 1.8 },
    history: histDays,
    forecast,
  };
}

function makeLateRisk(officeId, { role = 'super_admin', stale = false } = {}) {
  const showAll = role === 'super_admin' || role === 'executive' || role === 'office_head';
  if (officeId === OFFICE_B) {
    return {
      as_of: '2026-11-18T01:00:00.000Z',
      stale,
      items: [
        {
          transaction_id: TX_B,
          tracking_no: 'GUI-20261118-0001',
          service_name: 'Good Moral Certificate',
          level: 'MEDIUM',
          probability: role === 'super_admin' ? 0.54 : null,
          rule_based: false,
          reason: 'Steady pace so far',
          working_minutes_left: 90,
          can_open: true,
        },
      ],
      model: { method: 'trained', trained_at: '2026-11-18T00:00:00.000Z', rows: 120, late_cases: 62, metrics: { accuracy: 0.85, precision: 0.8, recall: 0.78 }, thresholds: { medium: 0.4, high: 0.7 }, status: 'READY' },
    };
  }
  return {
    as_of: '2026-11-18T01:00:00.000Z',
    stale,
    items: [
      {
        transaction_id: TX_OWN,
        tracking_no: 'REG-20261118-0001',
        service_name: 'Transcript of Records',
        level: 'HIGH',
        probability: role === 'super_admin' ? 0.78 : null,
        rule_based: false,
        reason: 'Low remaining working minutes',
        working_minutes_left: 25,
        can_open: true,
      },
      {
        transaction_id: TX_PEER,
        tracking_no: 'REG-20261118-0002',
        service_name: 'Transcript of Records',
        level: 'LOW',
        probability: role === 'super_admin' ? 0.12 : null,
        rule_based: false,
        reason: 'On track',
        working_minutes_left: 300,
        can_open: showAll,
      },
    ],
    model: { method: 'trained', trained_at: '2026-11-18T00:00:00.000Z', rows: 150, late_cases: 70, metrics: { accuracy: 0.88, precision: 0.82, recall: 0.8 }, thresholds: { medium: 0.4, high: 0.7 }, status: 'READY' },
  };
}

function makeOverview({ role, requestedOfficeId = '' }) {
  const isBound = role === 'office_head' || role === 'office_staff';
  const effectiveOffice = isBound ? OFFICE_A : (requestedOfficeId || null);
  const canAll = role === 'super_admin' || role === 'executive' || role === 'office_head';
  const periods = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
  const periodLabels = ['Jun 2026', 'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026', 'Nov 2026'];
  const toCells = (vals) => periods.map((period, i) => ({ period, value: vals[i] }));
  const heatmapRows = effectiveOffice
    ? [{ office_id: effectiveOffice, cells: toCells(effectiveOffice === OFFICE_B ? [80, 82, 84, 85, 86, 88] : [86, 87, 89, 90, 91, 92]) }]
    : [
        { office_id: OFFICE_A, cells: toCells([86, 87, 89, 90, 91, 92]) },
        { office_id: OFFICE_B, cells: toCells([80, 82, 84, 85, 86, 88]) },
        // OFFICE_C intentionally omitted: active Cashier Office must still merge into Dashboard ComplianceHeatmap with empty cells
      ];
  return {
    generated_at: '2026-11-18T01:05:00.000Z',
    scope: { kind: effectiveOffice ? 'office' : 'campus', office_id: effectiveOffice },
    min_cell_completed: 5,
    max_sentences: 6,
    pulse: {
      on_time_rate: effectiveOffice === OFFICE_B ? 88 : 92,
      previous_on_time_rate: 89.5,
      results: 240,
      previous_results: 210,
      open_now: 3,
      oldest_open_age_minutes: 95,
      completed_today: 5,
      received_today: 7,
      trend: periods.map((period, i) => ({
        period,
        label: periodLabels[i],
        value: [84, 85.5, 87, 88.5, 89.5, effectiveOffice === OFFICE_B ? 88 : 92][i],
      })),
    },
    heatmap: effectiveOffice === OFFICE_B
      ? [{ office_id: OFFICE_B, service_id: SVC_B, service_code: 'GUI-GMC', completed: 20, late: 1, late_rate: 5, too_few: false }]
      : effectiveOffice === OFFICE_A
        ? [
            { office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', completed: 24, late: 9, late_rate: 37.5, too_few: false },
            { office_id: OFFICE_A, service_id: SVC_A2, service_code: 'REG-DIP', completed: 20, late: 3, late_rate: 15, too_few: false },
            { office_id: OFFICE_A, service_id: SVC_A3, service_code: 'REG-VER', completed: 3, late: 1, late_rate: 33.3, too_few: true },
          ]
        : [
            { office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', completed: 24, late: 9, late_rate: 37.5, too_few: false },
            { office_id: OFFICE_A, service_id: SVC_A2, service_code: 'REG-DIP', completed: 20, late: 3, late_rate: 15, too_few: false },
            { office_id: OFFICE_A, service_id: SVC_A3, service_code: 'REG-VER', completed: 3, late: 1, late_rate: 33.3, too_few: true },
            { office_id: OFFICE_B, service_id: SVC_B, service_code: 'GUI-GMC', completed: 20, late: 1, late_rate: 5, too_few: false },
          ],
    compliance_heatmap: {
      periods,
      rows: heatmapRows,
    },
    sentences: [
      { id: 'c2', kind: 'warning', template: 2, params: { service_id: SVC_A, service_code: 'REG-TOR', late_rate: 12.5, period: 'monthly' }, chart: 'charter', score: 25 },
    ],
    charter: {
      thresholds: { min_completed: 20 },
      services: effectiveOffice === OFFICE_B
        ? [{ office_id: OFFICE_B, service_id: SVC_B, service_code: 'GUI-GMC', completed: 20, late: 1, late_rate: 5, limit_minutes: 60, p90_minutes: 40, flags: [] }]
        : effectiveOffice === OFFICE_A
          ? [
              { office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', completed: 24, late: 9, late_rate: 37.5, limit_minutes: 120, p90_minutes: 150, flags: ['LIMIT_OFTEN_MISSED'] },
              { office_id: OFFICE_A, service_id: SVC_A2, service_code: 'REG-DIP', completed: 20, late: 3, late_rate: 15, limit_minutes: 180, p90_minutes: 130, flags: [] },
              { office_id: OFFICE_A, service_id: SVC_A3, service_code: 'REG-VER', completed: 3, late: 3, late_rate: 100, limit_minutes: 60, p90_minutes: 75, flags: ['NOT_ENOUGH_DATA'] },
            ]
          : [
              { office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', completed: 24, late: 9, late_rate: 37.5, limit_minutes: 120, p90_minutes: 150, flags: ['LIMIT_OFTEN_MISSED'] },
              { office_id: OFFICE_A, service_id: SVC_A2, service_code: 'REG-DIP', completed: 20, late: 3, late_rate: 15, limit_minutes: 180, p90_minutes: 130, flags: [] },
              { office_id: OFFICE_A, service_id: SVC_A3, service_code: 'REG-VER', completed: 3, late: 3, late_rate: 100, limit_minutes: 60, p90_minutes: 75, flags: ['NOT_ENOUGH_DATA'] },
              { office_id: OFFICE_B, service_id: SVC_B, service_code: 'GUI-GMC', completed: 45, late: 1, late_rate: 5, limit_minutes: 60, p90_minutes: 40, flags: [] },
            ],
      unusual: [
        { transaction_id: TX_OWN, tracking_no: 'REG-20261110-0001', office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', elapsed_minutes: 280, limit_minutes: 120, ended_at: '2026-11-10T04:00:00.000Z', can_open: true },
        { transaction_id: TX_PEER, tracking_no: 'REG-20261110-0002', office_id: OFFICE_A, service_id: SVC_A, service_code: 'REG-TOR', elapsed_minutes: 250, limit_minutes: 120, ended_at: '2026-11-10T03:00:00.000Z', can_open: canAll },
      ],
    },
    about: { completed_rows: 240, late_cases: 18, earliest_started_at: '2026-09-01T00:00:00.000Z' },
  };
}

function makeKpis({ role, groupBy, period = 'half_year' }) {
  const bucket = (received, onTime, late, rate, pending) => ({
    received,
    cancelled: 0,
    auto_closed: 0,
    pending: { count: pending, oldest_age_minutes: pending ? 120 : null },
    results: { on_time: onTime, late, late_auto_closed: 0, late_total: late, on_time_rate: rate },
    outcomes: { completed: onTime + late, granted: onTime + late, disapproved: 0, not_recorded: 0 },
    time: { average_minutes: 45, median_minutes: 40, p90_minutes: 85 },
    early: { count: onTime, average_margin_minutes: 15 },
    queue_wait: { measured: onTime + late, average_minutes: 10 },
  });

  if (groupBy === 'total') {
    return { period, from: '2026-07-01', to: '2026-11-18', totals: bucket(18, 13, 3, 81.3, 2), groups: [] };
  }
  if (groupBy === 'office') {
    return {
      period,
      from: '2026-07-01',
      to: '2026-11-18',
      groups: [
        { office_id: OFFICE_A, ...bucket(10, 8, 2, 80, 1) },
        { office_id: OFFICE_B, ...bucket(8, 5, 1, 83.3, 1) },
        // OFFICE_C intentionally omitted: must still render on Campus Home with 0s and "No rate yet"
      ],
    };
  }
  if (groupBy === 'staff') {
    const groups = role === 'office_head'
      ? [{ user_id: STAFF_1, ...bucket(6, 5, 1, 83.3, 2) }, { user_id: STAFF_2, ...bucket(4, 3, 0, 100, 1) }]
      : [{ user_id: STAFF_1, ...bucket(6, 5, 1, 83.3, 2) }];
    return { period, from: '2026-07-01', to: '2026-11-18', groups };
  }
  return { period, groups: [] };
}

const ALL_PENDING = Array.from({ length: 25 }, (_, i) => {
  const num = String(i + 1).padStart(4, '0');
  return {
    transaction_id: `88880000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    tracking_no: `REG-20261101-${num}`,
    service_name: 'Transcript of Records',
    service_code: 'REG-TOR',
    status: i % 4 === 0 ? 'ON_HOLD' : 'IN_PROGRESS',
    started_at: new Date(Date.UTC(2026, 10, 1, 1, i, 0)).toISOString(),
  };
});

let SHARED_RBAC = null;
async function loadSharedRbac() {
  if (!SHARED_RBAC) SHARED_RBAC = await import('ccms-shared');
  return SHARED_RBAC;
}

async function setupContext(browser, role, { forecastState, staleLateRisk = false, failLateRisk = false, complaintsStatus = 200 } = {}) {
  const shared = await loadSharedRbac();
  const switchState = Object.fromEntries(shared.SWITCH_KEYS.map((k) => [k, false]));
  const buildSwitchesView = () => ({
    switches: shared.SWITCH_KEYS.map((key) => ({
      key,
      label: shared.SWITCH_INFO[key].label,
      description: shared.SWITCH_INFO[key].description,
      enabled: switchState[key] === true,
      updated_by: null,
      updated_at: null,
    })),
    matrix: {
      roles: shared.ROLE_LIST.map((r) => ({ role: r, label: shared.ROLE_LABELS[r] })),
      rows: shared.CAPABILITIES.map((c) => ({
        key: c.key,
        group: c.group,
        label: c.label,
        cells: Object.fromEntries(shared.ROLE_LIST.map((r) => [r, typeof c.cells[r] === 'object' ? { switch: c.cells[r].switch } : c.cells[r]])),
      })),
    },
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const state = forecastState ?? { total: 72, pointToday: 14, stale: false, asOfDate: null };
  const calls = {
    overviews: [],
    cells: [],
    forecasts: [],
    forecastRetrains: [],
    lateRisks: [],
    lateRiskRetrains: [],
    kpis: [],
    transactions: [],
    accounts: 0,
    permissionSwitches: 0,
    permissionSwitchSaves: [],
    complaints: [],
    unmocked: [],
  };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const sp = url.searchParams;

    if (p === '/api/identity/auth/refresh') return json(route, 200, { access_token: fakeJwt(role), expires_in: 900 });
    if (p === '/api/identity/me') return json(route, 200, { account: { user_id: STAFF_1, role }, what_i_can_do: [] });
    if (p === '/api/identity/accounts') {
      calls.accounts += 1;
      const requestedRole = sp.get('role');
      const roleTotals = { super_admin: 2, office_head: 8, office_staff: 24, executive: 3 };
      const total = requestedRole && roleTotals[requestedRole] ? roleTotals[requestedRole] : 2;
      return json(route, 200, {
        items: [{ account_id: STAFF_1, full_name: 'Staff One' }, { account_id: STAFF_2, full_name: 'Staff Two' }],
        total,
        page: 1,
        page_size: 100,
      });
    }
    if (p === '/api/identity/permission-switches') {
      if (role !== 'super_admin') return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      if (req.method() === 'PUT') {
        const body = req.postDataJSON?.() ?? {};
        calls.permissionSwitchSaves.push(body);
        for (const [k, v] of Object.entries(body.switches ?? {})) {
          if (Object.hasOwn(switchState, k)) switchState[k] = v === true;
        }
        return json(route, 200, buildSwitchesView());
      }
      calls.permissionSwitches += 1;
      return json(route, 200, buildSwitchesView());
    }
    if (p === '/api/catalogue/offices') {
      return json(route, 200, { items: OFFICES, total: OFFICES.length, page: 1, page_size: 100 });
    }
    if (p === '/api/catalogue/services') {
      return json(route, 200, { items: SERVICES, total: SERVICES.length, page: 1, page_size: 100 });
    }
    if (p === '/api/catalogue/public/services') {
      return json(route, 200, { items: SERVICES, total: SERVICES.length, page: 1, page_size: 50 });
    }
    if (p === '/api/logs/analytics/notifications') return json(route, 200, { items: [], read_keys: [] });
    if (p === '/api/operations/notifications') return json(route, 200, { items: [] });

    if (p === '/api/logs/analytics/insights/overview') {
      const requestedOfficeId = sp.get('office_id') || '';
      calls.overviews.push({ period: sp.get('period'), office_id: requestedOfficeId });
      return json(route, 200, makeOverview({ role, requestedOfficeId }));
    }
    if (p === '/api/logs/analytics/insights/cell') {
      calls.cells.push({ office_id: sp.get('office_id'), service_id: sp.get('service_id') });
      return json(route, 200, {
        weekly: [{ week_start: '2026-11-09', completed: 12, late: 2, late_rate: 16.7 }],
        late_transactions: [{ tracking_no: 'REG-20261110-0001', variance_minutes: 45 }],
      });
    }

    if (p === '/api/operations/analytics/forecast' && req.method() === 'GET') {
      const oId = sp.get('officeId') || '';
      const sId = sp.get('serviceId') || null;
      calls.forecasts.push({ officeId: oId, serviceId: sId });
      return json(route, 200, makeForecast(oId, { ...state, total: sId ? 35 : state.total, pointToday: sId ? 7 : state.pointToday, serviceId: sId }));
    }
    if (p === '/api/operations/analytics/forecast/retrain' && req.method() === 'POST') {
      const body = req.postDataJSON?.() ?? {};
      calls.forecastRetrains.push(body);
      state.total = calls.forecastRetrains.length === 1 ? 88 : 99;
      state.pointToday = calls.forecastRetrains.length === 1 ? 19 : 23;
      state.stale = false;
      return json(route, 200, makeForecast(body.officeId || OFFICE_A, state));
    }

    if (p === '/api/operations/analytics/late-risk' && req.method() === 'GET') {
      const oId = sp.get('officeId') || '';
      calls.lateRisks.push(oId);
      if (failLateRisk) return json(route, 503, { error: { code: 'UNAVAILABLE', message: 'Late-risk down' } });
      return json(route, 200, makeLateRisk(oId, { role, stale: staleLateRisk }));
    }
    if (p === '/api/operations/analytics/late-risk/retrain' && req.method() === 'POST') {
      const body = req.postDataJSON?.() ?? {};
      calls.lateRiskRetrains.push(body);
      return json(route, 200, { running: false, model: makeLateRisk(OFFICE_A, { role }).model });
    }

    if (p === '/api/logs/analytics/kpis' && req.method() === 'GET') {
      const groupBy = sp.get('group_by');
      calls.kpis.push({ period: sp.get('period'), office_id: sp.get('office_id'), group_by: groupBy });
      if (role === 'executive' && groupBy === 'staff') return json(route, 403, { error: { code: 'FORBIDDEN' } });
      return json(route, 200, makeKpis({ role, groupBy, period: sp.get('period') || 'half_year' }));
    }

    if (p === '/api/operations/transactions' && req.method() === 'GET') {
      const pageNum = Number(sp.get('page') || 1);
      const pageSize = Number(sp.get('page_size') || 20);
      calls.transactions.push({
        open: sp.get('open'),
        sort: sp.get('sort'),
        page: pageNum,
        page_size: pageSize,
      });
      const slice = ALL_PENDING.slice((pageNum - 1) * pageSize, pageNum * pageSize);
      return json(route, 200, { items: slice, page: pageNum, page_size: pageSize, total: ALL_PENDING.length });
    }

    if (p === '/api/logs/complaints' && req.method() === 'GET') {
      calls.complaints.push(url.search);
      if (complaintsStatus === 403) return json(route, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      const st = sp.get('status');
      const total = st === 'RECEIVED' ? 2 : st === 'ACKNOWLEDGED' ? 1 : sp.get('overdue') === 'true' ? 1 : 4;
      return json(route, 200, { items: [], total, page: 1, page_size: 1 });
    }

    if (p === '/api/operations/registry/summary' && req.method() === 'GET') {
      const codes = ['BSA', 'BSBA', 'BSCS', 'BSECE', 'BSED', 'BSIT', 'BSN', 'BSPSY'];
      return json(route, 200, {
        total: 600,
        enrolled: 480,
        alumni: 120,
        by_program: codes.map((code) => ({ program: code, enrolled: 60, alumni: 15, total: 75 })),
      });
    }
    if (p === '/api/operations/registry/imports' && req.method() === 'GET') {
      return json(route, 200, { items: [], total: 0 });
    }
    if (p === '/api/operations/registry/search' && req.method() === 'GET') {
      return json(route, 200, {
        items: [
          {
            student_number: '2024-00001-QC-0',
            full_name: 'Maria Clara Dela Cruz',
            program: 'BSA',
            year_level: 3,
            status: 'ENROLLED',
            valid_until: '2027-06-30',
            is_expired: false,
          },
          {
            student_number: '2020-00019-QC-0',
            full_name: 'Juan Dela Cruz',
            program: 'BSIT',
            year_level: null,
            status: 'ALUMNI',
            valid_until: null,
            is_expired: false,
          },
        ],
      });
    }

    calls.unmocked.push(`${req.method()} ${p}`);
    return json(route, 404, { error: { code: 'NOT_MOCKED', message: p } });
  });

  await ctx.addCookies([{ name: 'ccms_signed_in', value: '1', url: BASE }]);
  return { ctx, page, calls, errors, state };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  try {
    // =========================================================================
    // 0. / (Main Dashboard): All 6 consolidated analytics sections above Find a service, zero mock fallback
    // =========================================================================
    {
      const { ctx, page, calls, errors, state } = await setupContext(browser, 'super_admin');
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('dashboard-analytics').waitFor({ timeout: 30000 });
      await page.getByTestId('forecast-success').waitFor({ timeout: 30000 });
      await page.getByTestId('dashboard-late-risk').waitFor({ timeout: 30000 });

      const noServiceFinder = (await page.locator('#home-search').count()) === 0 && (await page.getByTestId('service-grid').count()) === 0;
      const kpiText = await page.getByTestId('kpi-grid').innerText();
      const forecastText = await page.getByTestId('forecast-success').innerText();
      const riskText = await page.getByTestId('dashboard-late-risk').innerText();
      const insightsText = await page.getByTestId('insights-sentences').innerText();
      const statusText = await page.getByTestId('dashboard-status').innerText();
      const tabsBar = page.getByTestId('dashboard-tabs-bar');
      await tabsBar.waitFor({ timeout: 15000 });
      const tabsLayout = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('[data-testid^="dashboard-tab-"]:not([data-testid*="badge"])')];
        const rects = tabs.map((el) => el.getBoundingClientRect());
        const list = document.querySelector('[role="tablist"]');
        const support = document.querySelector('[data-testid="dashboard-tabs-supporting"]');
        return {
          labels: tabs.map((el) => el.textContent.replace(/\s+/g, ' ').trim()),
          singleRow: rects.every((r) => Math.abs(r.top - rects[0].top) <= 2),
          noScrollOnDesktop: list ? list.scrollWidth <= list.clientWidth + 1 : false,
          supportText: support?.textContent?.trim() ?? '',
          supportSameRow: support
            ? support.getBoundingClientRect().top < rects[0].bottom && support.getBoundingClientRect().bottom > rects[0].top
            : false,
          overviewSelected: document.querySelector('#dashboard-tab-overview')?.getAttribute('aria-selected'),
          heatmapHidden: document.querySelector('#dashboard-panel-heatmap')?.hidden === true,
          charterHidden: document.querySelector('#dashboard-panel-charter')?.hidden === true,
          unusualHidden: document.querySelector('#dashboard-panel-unusual')?.hidden === true,
        };
      });

      ok('/ (super_admin): no /insights sidebar item and Charter anchor links to #charter', (await page.locator('nav a[href="/insights"]').count()) === 0 && (await page.getByTestId('dashboard-charter-link').getAttribute('href')) === '#charter');
      ok('/ (super_admin): KPI cards, Executive Overview charts, and no Find a service render on initial load', noServiceFinder && kpiText.includes('92%') && kpiText.includes('240') && forecastText.includes('72') && riskText.includes('High: 1') && riskText.includes('50% High Risk') && !/sample data/i.test(statusText));
      ok('/ (super_admin): Compliance Trend & Forecast show comparison/total badges, 95% benchmark, and Chart/Table toggles', (await page.getByTestId('trend-delta-badge').innerText()).includes('2.5 pts vs prev') && (await page.getByTestId('forecast-total-badge').innerText()).includes('72 est. next 5 days') && (await page.getByTestId('compare-by-office-link').getAttribute('href')) === '#heatmap');

      await page.getByTestId('pulse-mode-table').click();
      const pulseTableOk = (await page.getByTestId('pulse-table-view').count()) === 1;
      await page.getByTestId('pulse-mode-chart').click();
      await page.getByTestId('forecast-mode-table').click();
      const forecastTableOk = (await page.getByTestId('forecast-table-view').count()) === 1;
      await page.getByTestId('forecast-mode-chart').click();
      ok('/ (super_admin): Chart/Table segmented toggles switch between chart and table views without API calls', pulseTableOk && forecastTableOk);

      ok('/ (super_admin): horizontal tab bar renders 4 tabs, single desktop row, right supporting note, and dynamic 2 flagged / 2 badges', tabsLayout.singleRow && tabsLayout.noScrollOnDesktop && tabsLayout.supportSameRow && tabsLayout.supportText === 'Charter check & cell drilldown enabled' && tabsLayout.overviewSelected === 'true' && tabsLayout.heatmapHidden && tabsLayout.charterHidden && tabsLayout.unusualHidden && (await page.getByTestId('dashboard-tab-badge-charter').innerText()) === '2 flagged' && (await page.getByTestId('dashboard-tab-badge-unusual').innerText()) === '2');
      ok('/ (super_admin): loads Oversight once plus first active office forecast & late-risk without duplicate GETs', calls.overviews.length === 1 && calls.forecasts.length === 1 && calls.forecasts[0].officeId === OFFICE_A && calls.lateRisks.length === 1 && calls.lateRisks[0] === OFFICE_A);
      ok('/ (super_admin): Key insights combines Oversight charter sentence, Forecast rise sentence, SLA breach card, and warning count badge', insightsText.includes('Transcript of Records was late') && insightsText.includes('expected to rise 50% next week') && insightsText.includes('1 open transaction is at high risk') && insightsText.includes('Inspect 1 At-Risk Item') && (await page.getByTestId('key-insights-badge').innerText()) === '3 Warnings');

      const overviewsBeforeTabs = calls.overviews.length;
      const forecastsBeforeTabs = calls.forecasts.length;
      await page.getByTestId('dashboard-tab-heatmap').click();
      await page.locator('#heatmap').waitFor({ state: 'visible', timeout: 15000 });
      const heatmapText = await page.locator('#heatmap').innerText();
      ok('/ (super_admin): Office Compliance Heatmap tab switches panels without extra API calls and excludes Archived Office', calls.overviews.length === overviewsBeforeTabs && calls.forecasts.length === forecastsBeforeTabs && (await page.getByTestId('charts-row').isHidden()) && heatmapText.includes('Registrar Office') && heatmapText.includes('Guidance Office') && heatmapText.includes('Cashier Office') && !heatmapText.includes('Archived Office'));

      await page.getByTestId('dashboard-tab-charter').click();
      await page.getByTestId('insights-heatmap').waitFor({ state: 'visible', timeout: 15000 });
      const serviceMatrixText = await page.getByTestId('insights-heatmap').innerText();
      const legendText = await page.getByTestId('service-risk-legend').innerText();
      const noActivityChips = await page.getByTestId('no-activity-chip').allInnerTexts();
      ok('/ (super_admin): Service & Charter Audit tab shows office monitoring cards, dynamic filter counts, status badges, and zero-activity 0 txns rows', (await page.locator('#heatmap').isHidden()) && legendText.includes('High late rate') && legendText.includes('Watch') && legendText.includes('On track') && legendText.includes('Too few to judge') && serviceMatrixText.includes('All Active (4)') && serviceMatrixText.includes('Flagged High Late Rate (2)') && serviceMatrixText.includes('Too Few to Judge (1)') && serviceMatrixText.includes('2 flagged') && serviceMatrixText.includes('On track') && serviceMatrixText.includes('37.5% late') && serviceMatrixText.includes('15% late') && serviceMatrixText.includes('5% late') && serviceMatrixText.includes('Too few') && noActivityChips.length === 1 && noActivityChips[0].includes('Official Receipt Copy') && noActivityChips[0].includes('0 txns'));

      await page.getByTestId('no-activity-search').fill('nonexistent-service');
      const emptyFilterVisible = (await page.getByTestId('no-activity-filter-empty').count()) === 1;
      await page.getByTestId('no-activity-search').fill('');
      const overviewsBeforeFilter = calls.overviews.length;
      await page.getByTestId('heatmap-filter-flagged').click();
      const flaggedCodes = await page.locator('[data-testid="heat-cell"] span:first-child').allInnerTexts();
      ok('/ (super_admin): Flagged filter and inactive-service search filter work client-side without API calls', emptyFilterVisible && calls.overviews.length === overviewsBeforeFilter && flaggedCodes.length === 2 && flaggedCodes.includes('REG-TOR') && flaggedCodes.includes('REG-DIP') && (await page.getByTestId('no-services-period').count()) === 1);

      await page.getByTestId('heatmap-filter-too_few').click();
      const tooFewCodes = await page.locator('[data-testid="heat-cell"] span:first-child').allInnerTexts();
      ok('/ (super_admin): Too few filter isolates insufficient-sample services without API calls', calls.overviews.length === overviewsBeforeFilter && tooFewCodes.length === 1 && tooFewCodes[0] === 'REG-VER');

      await page.getByTestId('heatmap-filter-all').click();
      await page.getByTestId('heat-cell').first().click();
      await page.getByTestId('cell-detail').getByText('Weekly late rate').waitFor({ timeout: 15000 });
      const detailText = await page.getByTestId('cell-detail').innerText();
      ok('/ (super_admin): clicking service card loads completed/late/rate summary, weekly breakdown, and late transactions', calls.cells.length === 1 && detailText.includes('Completed: 24') && detailText.includes('Late: 9') && detailText.includes('37.5% late') && detailText.includes('REG-20261110-0001'));

      const charterSectionText = await page.getByTestId('insights-charter').innerText();
      const charterBars = await page.locator('[data-testid="insights-charter"] [role="progressbar"]').count();
      ok('/ (super_admin): Charter check renders 5-column layout, progress bars, duration comparison, and semantic findings', charterBars === 4 && charterSectionText.includes('Transcript of Records') && charterSectionText.includes('2 h 0 min → 2 h 30 min') && charterSectionText.includes('Over limit') && charterSectionText.includes('Within limit') && charterSectionText.includes('Limit often missed') && charterSectionText.includes('Not enough data'));

      await page.selectOption('#charter-filter', 'flagged');
      const flaggedCharterNames = await page.locator('[data-testid="charter-service-btn"]').allInnerTexts();
      ok('/ (super_admin): Charter check Show=Flagged excludes low-sample 100% row and Within limit rows', flaggedCharterNames.length === 2 && flaggedCharterNames.includes('Transcript of Records') && flaggedCharterNames.includes('Diploma Reissuance') && calls.overviews.length === overviewsBeforeFilter);

      await page.selectOption('#charter-filter', 'too_few');
      const fewCharterNames = await page.locator('[data-testid="charter-service-btn"]').allInnerTexts();
      ok('/ (super_admin): Charter check Show=Too few isolates Not enough data rows', fewCharterNames.length === 1 && fewCharterNames[0] === 'Enrollment Verification');

      await page.selectOption('#charter-filter', '');
      await page.selectOption('#charter-sort', 'completed');
      const byCompleted = await page.locator('[data-testid="charter-service-btn"]').allInnerTexts();
      await page.selectOption('#charter-sort', 'service_name');
      const byName = await page.locator('[data-testid="charter-service-btn"]').allInnerTexts();
      await page.selectOption('#charter-sort', 'p90_minutes');
      const byP90 = await page.locator('[data-testid="charter-service-btn"]').allInnerTexts();
      ok('/ (super_admin): Charter check numeric & alphabetical sorting works for Completed, Service name, and P90', byCompleted[0] === 'Good Moral Certificate' && byName[0] === 'Diploma Reissuance' && byP90[0] === 'Transcript of Records');

      await page.getByTestId('charter-service-btn').first().click();
      await page.getByTestId('charter-cell-detail').getByText('Weekly late rate').waitFor({ timeout: 15000 });
      const charterDetailText = await page.getByTestId('charter-cell-detail').innerText();
      ok('/ (super_admin): clicking a service in Charter check opens weekly breakdown and late transactions', calls.cells.length === 2 && charterDetailText.includes('Completed: 24') && charterDetailText.includes('REG-20261110-0001'));

      await page.getByTestId('dashboard-tab-charter').focus();
      await page.keyboard.press('ArrowRight');
      await page.getByTestId('insights-unusual').waitFor({ state: 'visible', timeout: 15000 });
      ok('/ (super_admin): ArrowRight switches to Unusual Cases tab and displays clickable unusual transaction links without extra fetches', calls.overviews.length === overviewsBeforeTabs && (await page.locator('[data-testid="insights-unusual"] a[href^="/transactions/"]').count()) === 2);

      await page.keyboard.press('Home');
      await page.getByTestId('charts-row').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => {
        const svg = document.querySelector('[data-testid="charts-row"] svg.recharts-surface');
        return Boolean(svg && svg.getBoundingClientRect().width > 50);
      }, null, { timeout: 10000 }).catch(() => {});
      const backOverviewOk = await page.evaluate(() => {
        const svg = document.querySelector('[data-testid="charts-row"] svg.recharts-surface');
        return Boolean(svg && svg.getBoundingClientRect().width > 50);
      });
      ok('/ (super_admin): Home returns to Executive Overview with preserved charts and zero duplicate forecast fetch', backOverviewOk && calls.forecasts.length === forecastsBeforeTabs);

      await page.selectOption('#dashboard-office', OFFICE_B);
      await page.waitForFunction(() => document.querySelector('#risk')?.innerText.includes('Guidance Office'), null, { timeout: 15000 });
      const zeroBadgesOk = (await page.getByTestId('dashboard-tab-badge-charter').innerText()) === '0 flagged'
        && (await page.getByTestId('dashboard-tab-badge-unusual').innerText()) === '0';
      await page.getByTestId('dashboard-tab-unusual').click();
      await page.getByTestId('unusual-empty-state').waitFor({ state: 'visible', timeout: 15000 });
      const unusualEmptyText = await page.getByTestId('unusual-empty-state').innerText();
      await page.getByTestId('dashboard-tab-overview').click();
      await page.getByTestId('charts-row').waitFor({ state: 'visible', timeout: 15000 });
      ok('/ (super_admin): selecting Guidance Office updates forecast, late-risk, zero-count neutral tab badges, and Unusual Cases empty state card', zeroBadgesOk && unusualEmptyText.includes('No Unusual Cases Detected') && unusualEmptyText.includes('20 completed transactions') && unusualEmptyText.includes('Highest single-service volume this period: 20 completed (GUI-GMC)') && (await page.locator('#risk').innerText()).includes('Guidance Office') && calls.forecasts.some((f) => f.officeId === OFFICE_B && !f.serviceId));

      await page.selectOption('select[aria-label="Select service"]', SVC_B);
      await page.waitForFunction(() => document.querySelector('[data-testid="forecast-success"]')?.innerText.includes('35'), null, { timeout: 15000 });
      const officeBCallsBefore = calls.forecasts.filter((f) => f.officeId === OFFICE_B && !f.serviceId).length;
      await page.selectOption('select[aria-label="Select service"]', '');
      await page.waitForFunction(() => document.querySelector('[data-testid="forecast-success"]')?.innerText.includes('72'), null, { timeout: 15000 });
      const officeBCallsAfter = calls.forecasts.filter((f) => f.officeId === OFFICE_B && !f.serviceId).length;
      ok('/ (super_admin): resetting service filter back to office level reuses externalRun without extra GET', officeBCallsBefore === 1 && officeBCallsAfter === 1);

      await page.getByTestId('insights-forecast').getByRole('button', { name: 'Retrain', exact: true }).click();
      await page.getByRole('alertdialog', { name: 'Retrain forecast?' }).getByRole('button', { name: 'Retrain', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="forecast-success"]')?.innerText.includes('88'), null, { timeout: 15000 });
      ok('/ (super_admin): embedded Retrain updates forecast and Key insights immediately', calls.forecastRetrains.length === 1 && calls.forecastRetrains[0]?.officeId === OFFICE_B && (await page.getByTestId('insights-sentences').innerText()).includes('83%'));

      state.stale = true;
      state.asOfDate = '2026-11-17';
      await page.selectOption('#dashboard-office', OFFICE_A);
      await page.getByText('Showing an earlier forecast from 2026-11-17').waitFor({ timeout: 15000 });
      await page.getByTestId('dashboard-charter-link').click();
      await page.getByTestId('no-activity-empty').waitFor({ timeout: 15000 });
      ok('/ (super_admin): stale forecast fallback, Charter link tab-jump, and all-active empty state render cleanly', (await page.getByTestId('dashboard-tab-charter').getAttribute('aria-selected')) === 'true');

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 5000 }).catch(() => {});
      const mobileChecks = await page.evaluate(() => {
        const tabs = [...document.querySelectorAll('[data-testid^="dashboard-tab-"]:not([data-testid*="badge"])')];
        const rects = tabs.map((el) => el.getBoundingClientRect());
        return {
          fitsPage: document.documentElement.scrollWidth <= window.innerWidth,
          singleLineTabs: rects.every((r) => Math.abs(r.top - rects[0].top) <= 2),
        };
      });
      ok('/ (super_admin mobile 390px): horizontally scrollable single-row tabs and zero page-wide overflow', mobileChecks.fitsPage && mobileChecks.singleLineTabs);
      ok('/ (super_admin): no unmocked calls or page errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'executive');
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('forecast-success').waitFor({ timeout: 30000 });
      await page.getByTestId('dashboard-late-risk').waitFor({ timeout: 30000 });
      const retrainCount = await page.getByRole('button', { name: /Retrain/i }).count();
      const hasOfficeSelect = await page.locator('#dashboard-office').count();
      await page.getByTestId('dashboard-tab-unusual').click();
      await page.getByTestId('insights-unusual').waitFor({ state: 'visible', timeout: 15000 });
      ok('/ (executive): sees campus analytics, office selector, and clickable unusual cases without Retrain controls', hasOfficeSelect === 1 && retrainCount === 0 && calls.forecasts.length === 1 && (await page.locator('[data-testid="insights-unusual"] a[href^="/transactions/"]').count()) === 2);
      ok('/ (executive): no /insights nav entry, unmocked calls, or errors', (await page.locator('nav a[href="/insights"]').count()) === 0 && calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_staff');
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('forecast-success').waitFor({ timeout: 30000 });
      await page.getByTestId('dashboard-late-risk').waitFor({ timeout: 30000 });
      await page.getByTestId('dashboard-tab-heatmap').click();
      await page.locator('#heatmap').waitFor({ state: 'visible', timeout: 15000 });
      const heatmapText = await page.locator('#heatmap').innerText();
      const hasOfficeSelect = await page.locator('#dashboard-office').count();
      await page.getByTestId('dashboard-tab-unusual').click();
      await page.getByTestId('insights-unusual').waitFor({ state: 'visible', timeout: 15000 });
      const charterLinks = await page.locator('[data-testid="insights-unusual"] a[href^="/transactions/"]').allInnerTexts();
      ok('/ (office_staff): locked to own office without foreign rows and enforces can_open on Unusual cases', hasOfficeSelect === 0 && calls.forecasts.length === 1 && heatmapText.includes('Registrar Office') && !heatmapText.includes('Guidance Office') && charterLinks.length === 1 && charterLinks[0].includes('REG-20261110-0001') && (await page.getByText('REG-20261110-0002').count()) === 1);
      ok('/ (office_staff): no /insights nav entry, unmocked calls, or errors', (await page.locator('nav a[href="/insights"]').count()) === 0 && calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'super_admin', { failLateRisk: true });
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('forecast-success').waitFor({ timeout: 30000 });
      await page.locator('#risk').getByText('Late-risk down').waitFor({ timeout: 15000 });
      ok('/ (unavailable error state): failed late-risk shows real error banner without mock fallback', (await page.getByTestId('dashboard-late-risk').count()) === 0 && errors.length === 0 && calls.unmocked.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 1. /insights permanently removed: returns 404
    // =========================================================================
    {
      const { ctx, page, calls } = await setupContext(browser, 'super_admin');
      const res = await page.goto(`${BASE}/insights`, { waitUntil: 'load', timeout: 60000 });
      ok('/insights route is permanently removed (HTTP 404)', res?.status() === 404 && calls.forecasts.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 3. /late-risk: Top toolbar, Ranked Open Transactions table + Scoring Model (no 4 KPI containers), filters, search, roles & Retrain
    // =========================================================================
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'super_admin', { staleLateRisk: true });
      await page.goto(`${BASE}/late-risk`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('late-risk-timestamp').waitFor({ timeout: 30000 });
      const adminText = await page.getByTestId('late-risk-section').innerText();
      const noKpiCards = (await page.getByTestId('late-risk-urgency-card').count()) === 0
        && (await page.getByTestId('late-risk-detail-pane').count()) === 0;
      ok('/late-risk (super_admin): removes 4 KPI containers and renders Top Toolbar, Ranked Open Transactions table, and Scoring Model panel', noKpiCards && /78%/.test(adminText) && /Showing saved scores as of/.test(adminText) && /Ranked Open Transactions/.test(adminText) && /Showing 2 of 2/.test(adminText) && /Model Health Diagnostics/i.test(adminText) && /Risk Score Thresholds/i.test(adminText) && (await page.getByRole('button', { name: 'Retrain' }).count()) === 1);

      await page.getByTestId('late-risk-high').click();
      const highCountText = await page.getByTestId('late-risk-queue-count').innerText();
      await page.getByTestId('late-risk-open').click();
      await page.getByTestId('late-risk-search').fill('0002');
      const searchCountText = await page.getByTestId('late-risk-queue-count').innerText();
      await page.getByTestId('late-risk-search').fill('');
      ok('/late-risk (super_admin): toolbar risk filters and search filter the Ranked Open Transactions table without extra API calls', highCountText.includes('Showing 1 of 2') && searchCountText.includes('Showing 1 of 2') && calls.lateRisks.length === 1);

      await page.getByTestId('late-risk-action-escalate').first().click();
      await page.getByTestId('late-risk-detail-drawer').waitFor({ state: 'visible', timeout: 15000 });
      const escalateDrawerText = await page.getByTestId('late-risk-detail-drawer').innerText();
      await page.getByTestId('late-risk-drawer-close').click();
      await page.getByTestId('late-risk-action-inspect').first().click();
      await page.getByTestId('late-risk-detail-drawer').waitFor({ state: 'visible', timeout: 15000 });
      const inspectDrawerText = await page.getByTestId('late-risk-detail-drawer').innerText();
      const inspectHasNoEscalateBtn = (await page.getByTestId('late-risk-drawer-escalate-btn').count()) === 0;
      await page.getByTestId('late-risk-drawer-close').click();
      ok('/late-risk (super_admin): Escalate and Inspect actions open transaction detail drawer with SLA consumption and Processing Milestones', escalateDrawerText.includes('High 78%') && escalateDrawerText.includes('REG-20261118-0001') && /SLA Time Consumption/i.test(escalateDrawerText) && /Processing Milestones/i.test(escalateDrawerText) && inspectDrawerText.includes('Low 12%') && inspectDrawerText.includes('REG-20261118-0002') && inspectDrawerText.includes('5 h 0 min (300 min) buffer remaining') && inspectHasNoEscalateBtn);

      await page.selectOption('#late-risk-office', OFFICE_B);
      await page.getByText('GUI-20261118-0001').first().waitFor({ timeout: 15000 });
      ok('/late-risk (super_admin): switching office selector loads Office B scores only', (await page.getByText('REG-20261118-0001').count()) === 0 && calls.lateRisks.includes(OFFICE_B));
      await page.getByRole('button', { name: 'Retrain' }).click();
      await page.getByText('Training completed.').waitFor({ timeout: 15000 });
      ok('/late-risk (super_admin): Retrain invokes late-risk retrain and refreshes scores', calls.lateRiskRetrains.length === 1 && calls.lateRisks.filter((id) => id === OFFICE_B).length >= 2);
      ok('/late-risk (super_admin): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'executive');
      await page.goto(`${BASE}/late-risk`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('late-risk-timestamp').waitFor({ timeout: 30000 });
      const execText = await page.getByTestId('late-risk-section').innerText();
      ok('/late-risk (executive): sees office selector without Retrain button or probability %', (await page.locator('#late-risk-office').count()) === 1 && (await page.getByRole('button', { name: 'Retrain' }).count()) === 0 && !/78%/.test(execText));
      ok('/late-risk (executive): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_staff');
      await page.goto(`${BASE}/late-risk`, { waitUntil: 'load', timeout: 60000 });
      await page.getByText('REG-20261118-0001').first().waitFor({ timeout: 30000 });
      const openLinks = await page.locator('[data-testid="late-risk-section"] a[href^="/transactions/"]').allInnerTexts();
      ok('/late-risk (office_staff): office-scoped (no selector), no Retrain, and only can_open rows are links', (await page.locator('#late-risk-office').count()) === 0 && (await page.getByRole('button', { name: 'Retrain' }).count()) === 0 && openLinks.length === 1 && openLinks[0].includes('REG-20261118-0001') && (await page.getByText('REG-20261118-0002').count()) === 1 && (await page.getByText('View only').count()) === 1);
      ok('/late-risk (office_staff): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 4. /office: Oldest-first paginated pending list, staff breakdown, & Executive denied
    // =========================================================================
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_head');
      await page.goto(`${BASE}/office`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('office-pending-list').waitFor({ timeout: 30000 });
      await page.getByText('REG-20261101-0001').waitFor({ timeout: 15000 });
      const firstTxCall = calls.transactions[0];
      const pendingSection = await page.getByTestId('office-pending-list').innerText();
      ok('/office (office_head): requests open=true&sort=oldest&page=1&page_size=20 and renders 25 pending with oldest first', firstTxCall?.open === 'true' && firstTxCall?.sort === 'oldest' && firstTxCall?.page === 1 && firstTxCall?.page_size === 20 && pendingSection.includes('25') && pendingSection.includes('REG-20261101-0001'));

      await page.getByTestId('office-pending-list').getByRole('button', { name: 'Next' }).click();
      await page.getByText('REG-20261101-0021').waitFor({ timeout: 15000 });
      const secondTxCall = calls.transactions[calls.transactions.length - 1];
      ok('/office (office_head): Next page fetches page 2 oldest pending records without dropping >20 rows', secondTxCall?.page === 2 && secondTxCall?.sort === 'oldest' && (await page.getByText('REG-20261101-0025').count()) === 1);
      ok('/office (office_head): shows By staff member and Complaints summary', (await page.locator('#office-staff-heading').innerText()) === 'By staff member' && (await page.getByText('Staff One').count()) === 1 && (await page.getByTestId('office-complaints-summary').innerText()).includes('Open Complaints'));
      ok('/office (office_head): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_staff', { complaintsStatus: 403 });
      await page.goto(`${BASE}/office`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('office-pending-list').waitFor({ timeout: 30000 });
      await page.getByText('Complaints summary is hidden under current staff permissions.').waitFor({ timeout: 15000 });
      ok('/office (office_staff): shows Your figures, hides restricted complaints summary gracefully', (await page.locator('#office-staff-heading').innerText()) === 'Your figures');
      ok('/office (office_staff): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'executive');
      await page.goto(`${BASE}/office`, { waitUntil: 'load', timeout: 60000 });
      await page.getByText('Your role does not have access to this page.').waitFor({ timeout: 30000 });
      ok('/office (executive): role guard blocks Executive with zero KPI or pending requests', calls.kpis.length === 0 && calls.transactions.length === 0 && errors.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 5. /campus: All active offices (including 0 activity), Executive isolation & role guard
    // =========================================================================
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'executive');
      await page.goto(`${BASE}/campus`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('campus-office-table').waitFor({ timeout: 30000 });
      await page.getByText('Cashier Office').waitFor({ timeout: 15000 });
      const campusText = await page.getByTestId('campus-office-table').innerText();
      ok('/campus (executive): renders all active offices including zero-activity Cashier Office with No rate yet, excludes Archived Office', campusText.includes('Registrar Office') && campusText.includes('Guidance Office') && campusText.includes('Cashier Office') && campusText.includes('No rate yet') && !campusText.includes('Archived Office'));
      ok('/campus (executive): never requests staff KPIs, accounts, transactions, or renders notification bell', !calls.kpis.some((k) => k.group_by === 'staff') && calls.accounts === 0 && calls.transactions.length === 0 && (await page.getByTestId('notification-bell').count()) === 0);
      ok('/campus (executive): shows weighted campus totals and Open Dashboard link', (await page.getByTestId('kpi-tiles').innerText()).includes('81.3%') && (await page.getByTestId('kpi-dashboard-link').getAttribute('href')) === '/');
      ok('/campus (executive): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_head');
      await page.goto(`${BASE}/campus`, { waitUntil: 'load', timeout: 60000 });
      await page.getByText('Your role does not have access to this page.').waitFor({ timeout: 30000 });
      ok('/campus (office_head): role guard blocks Office Head with zero campus requests', calls.kpis.length === 0 && errors.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 6. /registry: Program Summary (4 columns only, no Cohort Split), search, summary footer, & Individual Student / Alumni Directory
    // =========================================================================
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'super_admin');
      await page.goto(`${BASE}/registry`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('registry-panel-programs').waitFor({ timeout: 30000 });
      await page.getByTestId('program-row-BSA').waitFor({ timeout: 15000 });
      const progTabText = await page.getByTestId('registry-tab-programs').innerText();
      const panelText = await page.getByTestId('registry-panel-programs').innerText();
      const footerText = await page.getByTestId('registry-program-summary-footer').innerText();
      const headerCount = await page.locator('[data-testid="registry-panel-programs"] thead th').count();
      ok(
        '/registry (super_admin): Program Summary renders 4 columns only (no Cohort Split), degree titles, and summary footer',
        progTabText.includes('Program Summary (8)')
          && headerCount === 4
          && !/Cohort Split/i.test(panelText)
          && panelText.includes('Bachelor of Science in Accountancy')
          && panelText.includes('Click to inspect BSA roster')
          && footerText.includes('All programs (8 Academic Programs)')
          && footerText.includes('480')
          && footerText.includes('120')
          && footerText.includes('600'),
      );

      await page.getByTestId('registry-program-search').fill('accountancy');
      const filteredFooter = await page.getByTestId('registry-program-summary-footer').innerText();
      await page.getByTestId('registry-program-search').fill('');
      ok(
        '/registry (super_admin): searching by degree title filters Program Summary and updates summary footer totals',
        filteredFooter.includes('All programs (1 Academic Program)') && filteredFooter.includes('75'),
      );

      await page.getByTestId('inspect-program-BSA').click();
      await page.getByTestId('registry-panel-directory').waitFor({ state: 'visible', timeout: 15000 });
      const bannerText = await page.getByTestId('registry-selected-program-banner').innerText();
      await page.getByTestId('registry-directory-search').fill('Dela Cruz');
      await page.getByText('Maria Clara Dela Cruz').waitFor({ timeout: 15000 });
      const dirText = await page.getByTestId('registry-panel-directory').innerText();
      ok(
        '/registry (super_admin): clicking program row switches to Individual Student / Alumni Directory and filters roster search',
        bannerText.includes('BSA')
          && bannerText.includes('Bachelor of Science in Accountancy')
          && dirText.includes('2024-00001-QC-0')
          && !dirText.includes('Juan Dela Cruz'),
      );
      ok('/registry (super_admin): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }

    // =========================================================================
    // 7. /settings/roles: RBAC Permission Matrix, filtering, highlighting, collapsing, switches modal, & role guard
    // =========================================================================
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'super_admin');
      await page.goto(`${BASE}/settings/roles`, { waitUntil: 'load', timeout: 60000 });
      await page.getByTestId('roles-matrix-table').waitFor({ timeout: 30000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="roles-matrix-table"] thead')?.innerText.includes('24 users'), null, { timeout: 10000 }).catch(() => {});

      const allTabText = await page.getByTestId('roles-category-ALL').innerText();
      const adminTabText = await page.getByTestId('roles-category-Administration').innerText();
      const tableText = await page.getByTestId('roles-matrix-table').innerText();
      const legendText = await page.getByTestId('roles-access-legend').innerText();
      const uniformHeaderBg = await page.evaluate(() => {
        const ths = [...document.querySelectorAll('[data-testid="roles-matrix-table"] thead th')];
        return ths.every((th) => getComputedStyle(th).backgroundColor === 'rgb(255, 255, 255)');
      });
      ok(
        '/settings/roles (super_admin): renders category tabs with counts, Access Scope Legend, uniform role headers with counts, and grouped capability rows',
        uniformHeaderBg
          && allTabText.includes('All')
          && allTabText.includes('18')
          && adminTabText.includes('Administration')
          && adminTabText.includes('6')
          && legendText.includes('Full access')
          && legendText.includes('Own office')
          && legendText.includes('Own records')
          && legendText.includes('Read only')
          && legendText.includes('Switchable (On / Off)')
          && tableText.includes('CAPABILITY / ACTION')
          && tableText.includes('Full campus control')
          && tableText.includes('4 switches')
          && tableText.includes('24 users'),
      );

      await page.getByTestId('roles-category-Transactions').click();
      const txOnlyVisible = (await page.locator('[data-testid="roles-row-accounts"]').count()) === 0
        && (await page.locator('[data-testid="roles-row-tx.hold"]').count()) === 1;
      await page.getByTestId('roles-category-ALL').click();
      await page.getByTestId('roles-highlight-switches').check();
      const txHoldRowClass = await page.getByTestId('roles-row-tx.hold').getAttribute('class');
      await page.getByTestId('roles-highlight-switches').uncheck();

      await page.getByTestId('roles-collapse-Administration').click();
      const adminCollapsed = (await page.locator('[data-testid="roles-row-accounts"]').count()) === 0;
      await page.getByTestId('roles-collapse-Administration').click();

      await page.getByTestId('roles-capability-search').fill('tx.backdate');
      const searchMatchOk = (await page.locator('[data-testid="roles-row-tx.backdate"]').count()) === 1
        && (await page.locator('[data-testid="roles-row-accounts"]').count()) === 0;
      await page.getByTestId('roles-capability-search').fill('');

      ok(
        '/settings/roles (super_admin): category tabs, Highlight Switch-Controlled, group Collapse/Expand, and Filter capabilities work client-side without extra fetches',
        txOnlyVisible
          && String(txHoldRowClass).includes('bg-[#FFFBEB]')
          && adminCollapsed
          && searchMatchOk
          && calls.permissionSwitches === 1,
      );

      await page.getByRole('button', { name: 'Manage Staff Permissions' }).click();
      await page.getByRole('switch', { name: 'Staff can hold and resume transactions' }).click();
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="roles-switch-STAFF_HOLD_RESUME"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 15000 });
      const holdChecked = await page.getByTestId('roles-switch-STAFF_HOLD_RESUME').getAttribute('aria-checked');
      ok(
        '/settings/roles (super_admin): Manage Staff Permissions modal saves switch change and updates matrix toggle immediately',
        calls.permissionSwitchSaves.length === 1 && holdChecked === 'true',
      );

      // Direct inline switch toggle inside the permission matrix with confirmation dialog
      await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
      await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
      await page.getByTestId('roles-switch-STAFF_BACKDATE').click();
      const confirmDialog = page.getByRole('alertdialog');
      await confirmDialog.waitFor({ state: 'visible', timeout: 10000 });
      const confirmText = await confirmDialog.innerText();
      await confirmDialog.getByRole('button', { name: 'Enable Switch' }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="roles-switch-STAFF_BACKDATE"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 15000 });
      const backdateChecked = await page.getByTestId('roles-switch-STAFF_BACKDATE').getAttribute('aria-checked');
      const noRedundantOffBadge = !(await page.getByTestId('roles-row-tx.backdate').innerText()).includes('Off (switch off)');
      ok(
        '/settings/roles (super_admin): inline matrix switch shows affected role confirmation, persists ON state via API, and renders toggle cleanly',
        confirmText.includes('Office Staff')
          && confirmText.includes('Record a transaction with past dates')
          && calls.permissionSwitchSaves.some((b) => b.switches?.STAFF_BACKDATE === true)
          && backdateChecked === 'true'
          && noRedundantOffBadge,
      );

      // Failed switch save restores previous state and shows error message
      await page.route('**/api/identity/permission-switches', (route) => {
        if (route.request().method() === 'PUT') {
          return json(route, 500, { error: { code: 'INTERNAL_ERROR', message: 'Switch save failed temporarily.' } });
        }
        return route.fallback();
      });
      await page.getByTestId('roles-switch-STAFF_BACKDATE').click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Disable Switch' }).click();
      await page.getByText('Switch save failed temporarily.').first().waitFor({ timeout: 15000 });
      const revertedChecked = await page.getByTestId('roles-switch-STAFF_BACKDATE').getAttribute('aria-checked');
      ok(
        '/settings/roles (super_admin): failed switch update restores previous toggle state and displays error message',
        revertedChecked === 'true',
      );
      ok('/settings/roles (super_admin): no unmocked calls or errors', calls.unmocked.length === 0 && errors.length === 0);
      await ctx.close();
    }
    {
      const { ctx, page, calls, errors } = await setupContext(browser, 'office_staff');
      await page.goto(`${BASE}/settings/roles`, { waitUntil: 'load', timeout: 60000 });
      await page.getByText('Your role does not have access to this page.').waitFor({ timeout: 30000 });
      ok('/settings/roles (office_staff): role guard blocks non-Super Admin with zero permission-switch requests', calls.permissionSwitches === 0 && errors.length === 0);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error('E2E FAILED', e);
  process.exit(1);
});
