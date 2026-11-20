// Sprint 6 TT1 seeded history v3: deterministic planning, the assignment by position, the write path's guarantees and
// complete removal.
// Authored for Codex; not run by the author. The planner runs against an in-memory engine with the fixture W calendar,
// never against a hosted Core.
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createTestDatabase } from 'ccms-shared/testing';
import { afterSync } from '../src/lib/after-sync.js';
import { entities } from '../src/lib/entities/index.js';
import { DEFAULTS, OFFICE_SHARES } from '../src/modules/seed/config.js';
import { PlanError, buildPlan, lateBounds, monthTargets } from '../src/modules/seed/planner.js';
import { apportion, createRandom, uuidFromName } from '../src/modules/seed/random.js';
import { purgeOversight, reservedRangeState, storedDigest, writeRun } from '../src/modules/seed/writer.js';
import { checkTargets, parseArgs } from '../scripts/seed-transactions.js';
import { engine } from './fake-core.js';

const OPTIONS = { ...DEFAULTS, asOf: '2026-11-12' };
const W = { 2: [480, 1140], 3: [480, 1140], 4: [480, 1140], 5: [480, 1140], 6: [480, 1020] };

function fixtureCore() {
  const e = engine(W);
  return {
    workingMinutes: async ({ start, end }) => e.workingMinutes(new Date(start).getTime(), new Date(end).getTime()),
    deadline: async ({ start, workingDays, heldMinutes = 0 }) => e.deadline(new Date(start).getTime(), workingDays, heldMinutes),
    addWorkingMinutes: async ({ datetime, minutes }) => e.advance(new Date(datetime).getTime(), minutes),
  };
}

// The real service families of the catalogue seed files (codes without "PUP-<office>-"), including two dental services.
const SERVICES = {
  REG: ['GRD-001', 'CRD-001', 'CRD-002', 'CRD-003', 'CRD-004', 'CRD-005', 'CRD-006'],
  OSAS: ['ACT-001', 'CNS-001', 'CNS-002', 'CRD-007', 'IDC-001', 'IDC-002', 'REC-001', 'REC-002'],
  ADMREG: ['ADM-001', 'ADM-002', 'ADM-003', 'ACC-001', 'ACC-002', 'ACC-003', 'GRD-001', 'GRD-002', 'CRD-001', 'VER-001'],
  ACAD: ['ENR-001', 'ENR-002', 'ENR-003', 'ENR-004', 'ENR-005', 'GRD-001', 'GRD-002', 'SHF-001', 'PET-001', 'PET-002'],
  ADMIN: ['FAC-001', 'FAC-002', 'CIR-001', 'MED-001', 'MED-002', 'MED-003', 'MED-004', 'CLR-001', 'CLR-002', 'CLR-003', 'DEN-001', 'DEN-002'],
  ACCT: ['CLR-001', 'FIN-001', 'FIN-002'],
  LIB: ['CIR-001', 'REF-001'],
  OSFA: ['DAT-001'],
};
// The registered office accounts of 11/12/2026 (8 heads, 8 staff), by office: [name, role, position].
const ACCOUNTS = {
  ACAD: [['Mark Aribon', 'office_head', 'Head, Academic Office'], ['Ednalyn Bataller', 'office_staff', 'Academic Aide']],
  ADMIN: [['John Robert Isip', 'office_head', 'Head, Campus Administrative Office'], ['Ma.Eugenia Halili', 'office_staff', 'Campus Nurse']],
  OSFA: [['Geronimo Cuadra', 'office_head', 'Head, Scholarship and Financial Assistance']],
  LIB: [['Klaribel Domingo', 'office_head', 'Librarian'], ['Jean-Paul De Guzman', 'office_staff', 'Librarian Staff'], ['Jann Liongson', 'office_staff', 'Librarian Staff']],
  ACCT: [['Rosalinda Madelo', 'office_head', 'Collecting and Disbursing Officer'], ['Hernando Liberato', 'office_staff', 'Collecting Officer']],
  REG: [['Cherryln Esparagoza', 'office_head', 'Campus Registrar'], ['Meryl Gonzalbo', 'office_staff', 'In-Charge, Student Records']],
  ADMREG: [['Cherryln Esparagoza', 'office_head', 'Campus Registrar'], ['Berna Bulawit', 'office_staff', 'In-charge, Admission']],
  OSAS: [['Alma C. Fernandez', 'office_head', 'Head, Office of Student Affairs and Services'], ['Melanie Bactasa', 'office_staff', 'Guidance Counselor, In-charge, Career and Placement Office']],
};

function fixtureInputs({ headsOnly = false, drop = null, without = null, eligibility = {} } = {}) {
  const offices = [];
  const services = [];
  const standards = [];
  const accounts = new Map();
  for (const [key] of OFFICE_SHARES) {
    const office = { office_id: uuidFromName(`office|${key}`), office_code: `PUP-${key}`, office_name: `${key} Office`, is_active: true };
    offices.push(office);
    SERVICES[key].forEach((suffix, index) => {
      const code = `PUP-${key}-${suffix}`;
      if (code === drop) return;
      const service = {
        service_id: uuidFromName(`service|${code}`), office_id: office.office_id, service_code: code, service_name: `Service ${code}`,
        classification: index % 3 === 0 ? 'COMPLEX' : 'SIMPLE', is_active: true,
        allowed_client_types: eligibility[code] ?? ['STUDENT', 'ALUMNI', 'EMPLOYEE', 'EXTERNAL'],
      };
      services.push(service);
      standards.push({
        standard_id: uuidFromName(`standard|${code}`), service_id: service.service_id, effective_from: '2025-01-01', effective_to: null,
        duration_days: index % 3 === 0 ? 3 : 0, duration_hours: index % 3 === 0 ? 0 : 2, duration_minutes: index % 3 === 0 ? 0 : 30,
      });
    });
    accounts.set(office.office_id, ACCOUNTS[key]
      .filter(([name, role]) => name !== without && (!headsOnly || role === 'office_head'))
      .map(([name, role, position]) => ({ id: uuidFromName(`account|${key}|${name}`), role, name, position }))
      .sort((a, b) => a.id.localeCompare(b.id)));
  }
  const registry = [];
  for (let i = 0; i < 400; i += 1) registry.push({ student_number: `2024-${String(i).padStart(5, '0')}-QC-0`, status: 'ENROLLED', valid_until: i < 30 ? '2026-06-30' : '2027-06-30' });
  for (let i = 0; i < 150; i += 1) registry.push({ student_number: `2018-${String(i).padStart(5, '0')}-QC-0`, status: 'ALUMNI', valid_until: null });
  registry.sort((a, b) => a.student_number.localeCompare(b.student_number));
  const calendar = new Map();
  for (const office of offices) {
    const days = new Map();
    for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2026-11-12T00:00:00Z'); t += 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      const window = W[new Date(`${date}T12:00:00Z`).getUTCDay()];
      if (window) days.set(date, [{ open: window[0], close: window[1] }]);
    }
    calendar.set(office.office_id, days);
  }
  return { catalogue: { offices, services, standards }, accounts, registry, calendar, busyStaff: new Set() };
}

describe('TT1 helpers', () => {
  it('apportions exactly and deterministically', () => {
    const out = apportion(1000, Object.fromEntries(OFFICE_SHARES));
    assert.deepEqual([...out.values()], [220, 200, 180, 140, 140, 50, 40, 30]);
    assert.equal(createRandom('a').next(), createRandom('a').next());
    assert.notEqual(createRandom('a').next(), createRandom('b').next());
  });

  it('gives the v3 month targets for the default period and the late bounds', () => {
    assert.deepEqual(Object.fromEntries(monthTargets(OPTIONS)), {
      '2026-01': 45, '2026-02': 40, '2026-03': 45, '2026-04': 55, '2026-05': 60, '2026-06': 55,
      '2026-07': 100, '2026-08': 170, '2026-09': 130, '2026-10': 250, '2026-11': 50,
    });
    assert.deepEqual(lateBounds(1000), { min: 150, max: 180, target: 165 });
    assert.deepEqual(lateBounds(700), { min: 110, max: 125, target: 116 });
  });

  it('parses flags strictly and refuses a non-demo target, even for a dry run', () => {
    const now = new Date('2026-11-12T02:00:00Z');
    assert.equal(parseArgs(['--dry-run'], now).asOf, '2026-11-12');
    assert.deepEqual([parseArgs(['--dry-run'], now).from, parseArgs(['--dry-run'], now).volume, parseArgs(['--dry-run'], now).openTarget], ['2026-01-05', 1000, 8]);
    const presenter = randomUUID();
    assert.deepEqual(parseArgs(['--dry-run', `--presenters=${presenter}`], now).presenters, [presenter]);
    assert.throws(() => parseArgs(['--dry-run', '--presenters=not-an-id'], now), /--presenters/);
    assert.equal(parseArgs(['--dry-run', '--seed=abc', '--volume=700'], now).seed, 'abc');
    for (const bad of [['--dry-run', '--remove'], ['--volume=abc'], ['--from=2026-13-01'], ['--as-of=2026-11-01'], ['--nope'], ['--seed']]) {
      assert.throws(() => parseArgs(bad, now), undefined, bad.join(' '));
    }
    assert.throws(() => checkTargets(parseArgs(['--dry-run'], now), { DATABASE_URL: 'postgres://u:p@127.0.0.1/ops' }), /SEED_TARGET=demo/);
    assert.doesNotThrow(() => checkTargets(parseArgs(['--dry-run'], now), { SEED_TARGET: 'demo', DATABASE_URL: 'postgres://u:p@127.0.0.1/ops' }));
  });

  it('fails closed on writes without allowlisted targets, confirmation, current backups and an operator', () => {
    const now = new Date('2026-11-12T02:00:00Z');
    const env = {
      SEED_TARGET: 'demo', DATABASE_URL: 'postgres://u:p@db.demo.test/ops_demo', SEED_DEMO_DATABASES: 'db.demo.test/ops_demo',
      OVERSIGHT_SERVICE_URL: 'https://oversight-demo.test', SEED_DEMO_OVERSIGHT_HOSTS: 'oversight-demo.test',
      SEED_BACKUP_OPERATIONS_REF: 'br-ops-1', SEED_BACKUP_OVERSIGHT_REF: 'br-ovs-1', SEED_BACKUP_VERIFIED_AT: '2026-11-12T01:00:00Z',
    };
    const args = ['--confirm=ops_demo', `--operator=${randomUUID()}`];
    assert.doesNotThrow(() => checkTargets(parseArgs(args, now), env, now));
    const without = (key) => Object.fromEntries(Object.entries(env).filter(([k]) => k !== key));
    for (const key of ['SEED_DEMO_DATABASES', 'SEED_DEMO_OVERSIGHT_HOSTS', 'SEED_BACKUP_OPERATIONS_REF', 'SEED_BACKUP_OVERSIGHT_REF', 'SEED_BACKUP_VERIFIED_AT']) {
      assert.throws(() => checkTargets(parseArgs(args, now), without(key), now), undefined, key);
    }
    assert.throws(() => checkTargets(parseArgs(args, now), { ...env, SEED_BACKUP_VERIFIED_AT: '2026-11-10T01:00:00Z' }, now), /24 hours/);
    assert.throws(() => checkTargets(parseArgs(['--confirm=other', `--operator=${randomUUID()}`], now), env, now), /--confirm/);
    assert.throws(() => checkTargets(parseArgs(['--confirm=ops_demo'], now), env, now), /--operator/);
  });
});

describe('TT1 planner', { timeout: 600_000 }, () => {
  let plan;
  before(async () => {
    plan = await buildPlan({ inputs: fixtureInputs(), options: OPTIONS, core: fixtureCore() });
  });

  it('meets the volume, month and office targets exactly', () => {
    const d = plan.diagnostics;
    assert.equal(d.completed, 1000);
    assert.deepEqual(d.months, {
      '2026-01': 45, '2026-02': 40, '2026-03': 45, '2026-04': 55, '2026-05': 60, '2026-06': 55,
      '2026-07': 100, '2026-08': 170, '2026-09': 130, '2026-10': 250, '2026-11': 50,
    });
    assert.deepEqual(d.offices, { REG: 220, OSAS: 200, ADMREG: 180, ACAD: 140, ADMIN: 140, ACCT: 50, LIB: 40, OSFA: 30 });
  });

  it('computes 150-180 late (15-18%) from the engine, with open rows outside the denominator', () => {
    const late = plan.completed.filter((r) => r.is_compliant === false).length;
    assert.ok(late >= 150 && late <= 180, String(late));
    assert.ok(plan.open.every((r) => r.status === 'IN_PROGRESS' && r.is_compliant === undefined && !r.ended_at));
    assert.ok(plan.completed.every((r) => Number.isInteger(r.elapsed_working_minutes) && typeof r.is_compliant === 'boolean'));
  });

  it('plans 8 open rows (K32): one per staff account, none for an Office Head, covering Low, Medium and High', () => {
    assert.equal(plan.open.length, 8);
    assert.equal(new Set(plan.open.map((r) => r.started_by)).size, plan.open.length);
    const heads = new Set(['Mark Aribon', 'John Robert Isip', 'Geronimo Cuadra', 'Klaribel Domingo', 'Rosalinda Madelo', 'Cherryln Esparagoza', 'Alma C. Fernandez']);
    assert.ok(plan.open.every((r) => !heads.has(r.started_by_name)), 'the heads stay free for the presenters');
    assert.deepEqual(plan.diagnostics.open_by_office, { REG: 1, OSAS: 1, ADMREG: 1, ACAD: 1, ADMIN: 1, ACCT: 1, LIB: 2, OSFA: 0 });
    for (const level of ['LOW', 'MEDIUM', 'HIGH']) assert.ok(plan.diagnostics.open_risk_coverage[level] >= 1, level);
  });

  it('gives each row to the person who handles the service (K34) and leaves the dental services unused', () => {
    const rows = [...plan.completed, ...plan.open];
    const by = (prefix) => new Set(rows.filter((r) => r.service_code.startsWith(`PUP-${prefix}`)).map((r) => r.started_by_name));
    assert.deepEqual([...by('ADMIN-MED-')], ['Ma.Eugenia Halili']);
    assert.deepEqual([...by('ADMIN-CLR-')], ['Ma.Eugenia Halili']);
    assert.deepEqual([...by('ADMIN-FAC-')], ['John Robert Isip']);
    assert.deepEqual([...by('OSAS-CNS-')], ['Melanie Bactasa']);
    assert.deepEqual([...by('OSAS-REC-')], ['Melanie Bactasa']);
    assert.deepEqual([...by('OSAS-ACT-')], ['Alma C. Fernandez']);
    assert.deepEqual([...by('REG-')], ['Meryl Gonzalbo']);
    assert.deepEqual([...by('ADMREG-ADM-')], ['Berna Bulawit']);
    assert.deepEqual([...by('ADMREG-ACC-')], ['Cherryln Esparagoza']);
    assert.deepEqual([...by('ACAD-GRD-')], ['Mark Aribon']);
    assert.deepEqual([...by('ACCT-FIN-')], ['Rosalinda Madelo']);
    assert.deepEqual([...by('OSFA-')], ['Geronimo Cuadra']);
    assert.ok([...by('LIB-CIR-')].every((n) => ['Jean-Paul De Guzman', 'Jann Liongson'].includes(n)));
    assert.ok(plan.completed.every((r) => r.ended_by === r.started_by));
    assert.equal(rows.filter((r) => r.service_code.startsWith('PUP-ADMIN-DEN-')).length, 0);
    assert.equal(plan.diagnostics.assignment.fallback_rows, 0);
    assert.deepEqual(plan.diagnostics.assignment.services_left_out_by_rule, { ADMIN: 2 });
  });

  it('uses reserved tracking numbers, no contact data, and the client mix', () => {
    const all = [...plan.completed, ...plan.open];
    assert.equal(new Set(all.map((r) => r.tracking_no)).size, all.length);
    assert.ok(all.every((r) => /^PUP-[A-Z]+-\d{8}-9\d{3}$/.test(r.tracking_no) && Number(r.tracking_no.slice(-4)) >= 9001));
    assert.ok(all.every((r) => !('client_email' in r) && !('client_reference' in r)));
    for (const [type, share] of [['STUDENT', 70], ['ALUMNI', 15], ['EMPLOYEE', 8], ['EXTERNAL', 7]]) {
      assert.ok(Math.abs(plan.diagnostics.client_mix_pct[type] - share) <= 2, type);
    }
    const misses = plan.completed.filter((r) => ['NOT_FOUND', 'EXPIRED'].includes(r.registry_status));
    assert.ok(misses.length > 0 && misses.every((r) => r.registry_miss_reason));
  });

  it('plants the patterns', () => {
    const p = plan.diagnostics.patterns;
    assert.ok(p.credential_rush_in_rush_weeks.late_pct >= 20 && p.credential_rush_in_rush_weeks.late_pct <= 40, JSON.stringify(p.credential_rush_in_rush_weeks));
    assert.ok(p.chronic_delay.late_pct >= 20 && p.chronic_delay.late_pct <= 40);
    assert.ok(p.acad_first_third.late_pct > p.acad_last_third.late_pct);
    assert.ok(p.generous_median_share_of_limit < 0.4);
    assert.ok(p.unusual_cases >= 3 && p.unusual_cases <= 5);
    assert.ok(p.assembly_october_vs_month_avg.october > 2 * p.assembly_october_vs_month_avg.other_month_avg);
    assert.ok(p.last_four_weeks >= 200 && p.last_four_weeks <= 260, String(p.last_four_weeks));
    for (const key of Object.keys(plan.diagnostics.zero_use_services)) {
      if (['REG', 'OSAS', 'ADMREG', 'ACAD', 'ADMIN'].includes(key)) assert.ok(plan.diagnostics.zero_use_services[key].length >= 1, key);
    }
  });

  it('is deterministic for the same seed and inputs, and different for another seed', async () => {
    const again = await buildPlan({ inputs: fixtureInputs(), options: OPTIONS, core: fixtureCore() });
    assert.equal(again.digest, plan.digest);
    const other = await buildPlan({ inputs: fixtureInputs(), options: { ...OPTIONS, seed: 'another' }, core: fixtureCore() });
    assert.notEqual(other.digest, plan.digest);
  });

  it('respects configured service eligibility (CC047)', async () => {
    const eligibility = { 'PUP-REG-CRD-005': ['ALUMNI'] };
    const narrowed = await buildPlan({ inputs: fixtureInputs({ eligibility }), options: OPTIONS, core: fixtureCore() });
    const rows = narrowed.completed.filter((r) => r.service_code === 'PUP-REG-CRD-005');
    assert.ok(rows.length > 0 && rows.every((r) => r.client_type === 'ALUMNI'));
  });

  it('fails with aggregate diagnostics when a pattern service or staff accounts are missing', async () => {
    await assert.rejects(buildPlan({ inputs: fixtureInputs({ drop: 'PUP-OSAS-ACT-001' }), options: OPTIONS, core: fixtureCore() }),
      (err) => err instanceof PlanError && err.diagnostics.problems.some((p) => p.includes('PUP-OSAS-ACT-001')));
    await assert.rejects(buildPlan({ inputs: fixtureInputs({ headsOnly: true }), options: OPTIONS, core: fixtureCore() }),
      (err) => err instanceof PlanError && err.diagnostics.problems.some((p) => p.startsWith('open rows')));
  });

  it('falls back to the rest of the office, and reports it, when a listed person is not registered (K34)', async () => {
    const fallback = await buildPlan({ inputs: fixtureInputs({ without: 'Ma.Eugenia Halili' }), options: OPTIONS, core: fixtureCore() });
    const medical = fallback.completed.filter((r) => r.service_code.startsWith('PUP-ADMIN-MED-') || r.service_code.startsWith('PUP-ADMIN-CLR-'));
    assert.ok(medical.length > 0 && medical.every((r) => r.started_by_name === 'John Robert Isip'));
    assert.deepEqual(fallback.diagnostics.assignment.missing_assignees_by_office, { ADMIN: 1 });
    assert.ok(fallback.diagnostics.assignment.fallback_rows >= medical.length);
    assert.equal(fallback.open.length, 7, 'ADMIN has no free account left, so one open row fewer');
  });

  it('keeps exactly the --presenters accounts free instead of the heads', async () => {
    const inputs = fixtureInputs();
    const staffOfAcad = inputs.accounts.get(inputs.catalogue.offices.find((o) => o.office_code === 'PUP-ACAD').office_id);
    const bataller = staffOfAcad.find((a) => a.name === 'Ednalyn Bataller');
    const chosen = await buildPlan({ inputs, options: { ...OPTIONS, presenters: [bataller.id] }, core: fixtureCore() });
    assert.ok(chosen.open.every((r) => r.started_by !== bataller.id));
    await assert.rejects(buildPlan({ inputs, options: { ...OPTIONS, presenters: [randomUUID()] }, core: fixtureCore() }),
      (err) => err instanceof PlanError && err.diagnostics.problems.some((p) => p.includes('--presenters')));
  });
});

describe('TT1 writer', { timeout: 600_000 }, () => {
  let testDb;
  let ds;
  let plan;
  const operator = { id: randomUUID(), role: 'super_admin' };
  const backups = { operations: 'br-ops', oversight: 'br-ovs' };
  before(async () => {
    testDb = await createTestDatabase({ entities, afterSync });
    ds = testDb.dataSource;
    plan = await buildPlan({ inputs: fixtureInputs(), options: OPTIONS, core: fixtureCore() });
  });
  after(async () => testDb?.drop());
  beforeEach(async () => {
    for (const table of ['analytics_outbox', 'audit_outbox', 'transaction_emails', 'seeded_transactions', 'seed_runs', 'transactions', 'tracking_sequences']) {
      await ds.query(`DELETE FROM ${table}`);
    }
  });

  const count = async (sql, params = []) => (await ds.query(sql, params))[0].n;
  const live = async () => {
    const id = randomUUID();
    await ds.query(`INSERT INTO transactions (transaction_id, tracking_no, service_id, service_code, service_name, office_id, office_code,
      service_classification, standard_id, standard_duration_days, standard_duration_hours, standard_duration_minutes, client_type,
      started_at, started_by, status) VALUES ($1, 'PUP-REG-20261015-0001', $2, 'PUP-REG-SVC-1', 'Live', $3, 'PUP-REG', 'SIMPLE', $4, 0, 1, 0,
      'EXTERNAL', now(), $5, 'COMPLETED')`, [id, randomUUID(), randomUUID(), randomUUID(), randomUUID()]);
    return id;
  };

  it('imports through the dedicated path: no sequences, no mail, analytics published, exactly one summary audit', async () => {
    const liveId = await live();
    const { counts } = await writeRun(ds, { mode: 'IMPORT', plan, options: OPTIONS, operator, inputsDigest: 'd', backups });
    const total = plan.completed.length + plan.open.length;
    assert.equal(counts.inserted_completed + counts.inserted_open, total);
    assert.equal(await count("SELECT count(*)::int AS n FROM transactions WHERE tracking_no ~ '-9[0-9]{3}$'"), total);
    assert.equal(await count('SELECT count(*)::int AS n FROM tracking_sequences'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM transaction_emails'), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM transactions WHERE client_email IS NOT NULL OR client_reference IS NOT NULL OR receipt_email_status <> 'NONE'"), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM analytics_outbox'), total);
    const audits = await ds.query("SELECT payload FROM audit_outbox ORDER BY created_at");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].payload.action, 'HISTORICAL_RECORDS_IMPORTED');
    assert.equal(audits[0].payload.entity_name, 'Historical records import');
    assert.equal(audits[0].payload.after_value.random_seed, OPTIONS.seed);
    assert.equal((await storedDigest(ds)).digest, plan.digest, 'stored business data equals the plan');
    assert.equal(await count('SELECT count(*)::int AS n FROM transactions WHERE transaction_id = $1', [liveId]), 1);
  });

  it('replaces its own rows on a re-run with the same business data and a new summary', async () => {
    await writeRun(ds, { mode: 'IMPORT', plan, options: OPTIONS, operator, inputsDigest: 'd', backups });
    const { counts } = await writeRun(ds, { mode: 'IMPORT', plan, options: OPTIONS, operator, inputsDigest: 'd', backups });
    assert.equal(counts.removed, plan.completed.length + plan.open.length);
    assert.equal((await storedDigest(ds)).digest, plan.digest);
    assert.equal(await count("SELECT count(*)::int AS n FROM audit_outbox WHERE payload->>'action' = 'HISTORICAL_RECORDS_IMPORTED'"), 2);
  });

  it('stops on an unowned row in the reserved range, changing nothing', async () => {
    const id = await live();
    await ds.query("UPDATE transactions SET tracking_no = 'PUP-REG-20261015-9500' WHERE transaction_id = $1", [id]);
    await assert.rejects(writeRun(ds, { mode: 'IMPORT', plan, options: OPTIONS, operator, inputsDigest: 'd', backups }), /not owned/);
    assert.equal(await count('SELECT count(*)::int AS n FROM seed_runs'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM audit_outbox'), 0);
  });

  it('removes every owned row and its outbox events, keeps live rows and audit history, and is safe to repeat', async () => {
    const liveId = await live();
    await writeRun(ds, { mode: 'IMPORT', plan, options: OPTIONS, operator, inputsDigest: 'd', backups });
    const { counts } = await writeRun(ds, { mode: 'REMOVE', options: {}, operator, backups });
    assert.equal(counts.removed, plan.completed.length + plan.open.length);
    assert.deepEqual(await reservedRangeState(ds), { owned: 0, unowned: 0, pendingOversightPurge: plan.completed.length + plan.open.length });
    assert.equal(await count('SELECT count(*)::int AS n FROM analytics_outbox'), 0);
    assert.equal(await count('SELECT count(*)::int AS n FROM transactions WHERE transaction_id = $1', [liveId]), 1);
    assert.equal(await count("SELECT count(*)::int AS n FROM audit_outbox WHERE payload->>'entity_type' = 'historical_import'"), 2);
    const again = await writeRun(ds, { mode: 'REMOVE', options: {}, operator, backups });
    assert.equal(again.counts.removed, 0);

    // Oversight purge: batches of at most 500 seeded ids, retried until none is pending; a failure leaves them pending.
    const sent = [];
    const ok = async (_url, init) => {
      const items = JSON.parse(init.body).items;
      sent.push(items.length);
      return new Response(JSON.stringify({ purged: items.length, tombstoned: items.length }), { status: 200 });
    };
    await assert.rejects(purgeOversight(ds, { oversightUrl: 'https://oversight.test', serviceKey: 'k', fetchImpl: async () => new Response('{}', { status: 503 }) }));
    const result = await purgeOversight(ds, { oversightUrl: 'https://oversight.test', serviceKey: 'k', fetchImpl: ok });
    assert.equal(result.pending, 0);
    assert.ok(sent.every((n) => n <= 500));
    assert.equal((await purgeOversight(ds, { oversightUrl: 'https://oversight.test', serviceKey: 'k', fetchImpl: ok })).purged, 0);
  });
});
