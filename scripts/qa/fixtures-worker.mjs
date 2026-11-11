// Explicit QA-only fixture creation. Normal domain functions retain their audit trail.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IsNull } from 'typeorm';
import { createDataSource, ROLES } from 'ccms-shared';
import { assertQaDatabaseTarget } from 'ccms-shared/qa';
import { root, qaDir, approvedFixtures, readJson, saveJson } from './common.mjs';

const phase = process.argv[2];
const moduleOf = (app, file) => import(pathToFileURL(join(root, 'apps', app, 'src', 'lib', file)).href);
let ds;

async function run() {
  const expected = { admin: 'identity-service', calendar: 'core-service', accounts: 'identity-service' }[phase];
  if (!expected || process.env.CCMS_ENVIRONMENT !== 'qa' || process.env.QA_SERVICE_KIND !== expected) throw new Error('Fixture worker requires its assigned QA environment');
  assertQaDatabaseTarget(process.env.DATABASE_URL);
  const pack = await approvedFixtures();
  const statePath = join(qaDir, 'fixture-state.json');
  let state;
  try { state = await readJson(statePath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  state ??= { targetSet: process.env.QA_TARGET_SET_ID, offices: {}, entries: {}, items: {}, phases: {} };
  if (state.targetSet !== process.env.QA_TARGET_SET_ID) throw new Error('Fixture state belongs to another QA set');
  const persist = () => saveJson(statePath, { ...state, updatedAt: new Date().toISOString() });
  const note = async (key, created, details = {}) => {
    // Keep creation evidence on a subsequent idempotent run.
    state.items[key] = { status: created || state.items[key]?.status === 'Created' ? 'Created' : 'Exists', ...details };
    await persist();
  };
  const { entities } = await moduleOf(expected, 'entities/index.js');
  ds = createDataSource({ entities, synchronize: false });
  await ds.initialize();

  if (phase === 'admin') {
    const { bootstrapSuperAdmin } = await moduleOf(expected, 'bootstrap.js');
    const { Account } = await moduleOf(expected, 'entities/index.js');
    const email = pack.superAdmin.email.trim().toLowerCase();
    const result = await bootstrapSuperAdmin(ds, { ...pack.superAdmin, email, password: process.env.QA_FIXTURE_PASSWORD });
    const account = await ds.getRepository(Account).findOneBy({ email });
    if (!account?.isActive || account.roleKey !== ROLES.SUPER_ADMIN || account.employeeNo !== pack.superAdmin.employeeNo || account.fullName !== pack.superAdmin.fullName) {
      throw new Error('The approved QA administrator does not match the existing administrator; no account was replaced');
    }
    state.actorId = account.accountId;
    await note('account:admin', result.created, { accountId: account.accountId });
  } else {
    if (!state.actorId) throw new Error('Create the QA administrator first');
    const actor = { id: state.actorId, role: ROLES.SUPER_ADMIN };
    if (phase === 'calendar') {
      const { Office, CalendarException } = await moduleOf(expected, 'entities/index.js');
      const { createOffice } = await moduleOf(expected, 'catalogue/offices.js');
      const { getCatalogueSettings, updateCatalogueSettings } = await moduleOf(expected, 'catalogue/settings.js');
      const { getSchedule, updateSchedule, parseScheduleInput } = await moduleOf(expected, 'calendar/schedule.js');
      const { createException, parseExceptionInput } = await moduleOf(expected, 'calendar/exceptions.js');
      let createdCalendar = false;
      for (const office of pack.offices) {
        const existing = await ds.getRepository(Office).findOneBy({ officeCode: office.office_code.trim() });
        if (existing && (!existing.isActive || existing.officeName !== office.office_name.trim())) throw new Error('A QA office differs from the approved fixture; no existing office was changed');
        const id = existing?.officeId ?? (await createOffice(ds, actor, office, { trustedCode: true })).office_id;
        state.offices[office.key] = id;
        await note(`office:${office.key}`, !existing, { officeId: id });
      }
      const settingsBefore = await getCatalogueSettings(ds);
      const settingsInput = pack.fixtureW.catalogueSettings;
      if (settingsInput && Object.entries(settingsInput).some(([key, value]) => settingsBefore[key] !== value)) {
        await updateCatalogueSettings(ds, actor, settingsInput);
        createdCalendar = true;
      }
      const days = parseScheduleInput({ days: pack.fixtureW.workingHours });
      const before = await getSchedule(ds);
      if (JSON.stringify(before) !== JSON.stringify(days)) {
        await updateSchedule(ds, actor, { days });
        createdCalendar = true;
      }
      const settings = await getCatalogueSettings(ds);
      for (const entry of pack.fixtureW.entries) {
        const { key, office_key: officeKey, ...body } = entry;
        if (!key || (officeKey && !state.offices[officeKey]) || Object.hasOwn(body, 'office_id')) throw new Error('Fixture W entries require a stable key and a declared office_key, never a foreign office ID');
        if (officeKey) body.office_id = state.offices[officeKey];
        const input = parseExceptionInput(body, { enabled: settings.applies_to_enabled });
        const repo = ds.getRepository(CalendarException);
        const existing = await repo.findOneBy({ exceptionDate: input.exceptionDate, officeId: input.officeId ?? IsNull(), removedAt: IsNull() });
        if (existing && Object.entries(input).some(([field, value]) => (existing[field] ?? null) !== (value ?? null))) throw new Error('An existing QA calendar entry differs from fixture W; no entry was changed');
        const id = existing?.exceptionId ?? (await createException(ds, actor, body)).exception_id;
        state.entries[key] = id;
        createdCalendar ||= !existing;
        await note(`calendar-entry:${key}`, !existing, { exceptionId: id });
      }
      await note('calendar-w', createdCalendar, { sourceReference: pack.fixtureW.sourceReference });
    } else {
      const { Account } = await moduleOf(expected, 'entities/index.js');
      const { createAccount } = await moduleOf(expected, 'accounts.js');
      let createdAccounts = state.items['account:admin']?.status === 'Created';
      for (const account of pack.accounts) {
        const { key, office_key: officeKey, ...fields } = account;
        if (Object.hasOwn(fields, 'office_id') || Object.hasOwn(fields, 'password')) throw new Error('QA accounts use declared office aliases and the generated QA password');
        const email = fields.email.trim().toLowerCase();
        const officeId = officeKey ? state.offices[officeKey] : null;
        if (officeKey && !officeId) throw new Error('Create fixture offices before their accounts');
        const existing = await ds.getRepository(Account).findOneBy({ email });
        if (existing && (!existing.isActive || existing.employeeNo !== fields.employee_no || existing.fullName !== fields.full_name || existing.roleKey !== fields.role || (existing.officeId ?? null) !== officeId || (existing.position ?? null) !== (fields.position || null))) {
          throw new Error('An existing QA account differs from the approved fixture; no account or password was changed');
        }
        const id = existing?.accountId ?? (await createAccount(ds, actor, { ...fields, email, office_id: officeId, password: process.env.QA_FIXTURE_PASSWORD })).account_id;
        createdAccounts ||= !existing;
        await note(`account:${key || email}`, !existing, { accountId: id });
      }
      await note('accounts', createdAccounts);
    }
  }
  state.phases[phase] = 'COMPLETED';
  state.checklist = pack.checklist.map((item) => ({ id: item.id, requirement: item.requirement,
    status: state.items[item.id]?.status ?? 'PENDING', evidence: state.items[item.id] ?? null }));
  await persist();
  console.log(`QA fixture phase ${phase} completed; evidence saved without credentials.`);
}

try { await run(); }
catch { console.error('QA fixture creation stopped. Check the approved fixture pack, QA prerequisites and partial fixture state; no existing records were reset.'); process.exitCode = 1; }
finally { if (ds?.isInitialized) await ds.destroy(); }
