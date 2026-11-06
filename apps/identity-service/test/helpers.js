import { randomUUID } from 'node:crypto';
import { Errors, ROLES, setDataSource } from 'ccms-shared';
import { createTestDatabase } from 'ccms-shared/testing';
import { afterSync } from '../src/lib/after-sync.js';
import { Account, entities } from '../src/lib/entities/index.js';
import { setMailer } from '../src/lib/mailer.js';
import { OFFICE_INVALID, OFFICE_UNREACHABLE, setOfficeVerifier } from '../src/lib/offices-client.js';
import { hashPassword } from '../src/lib/passwords.js';
import { signAccessToken } from '../src/lib/tokens.js';

export const OFFICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const OFFICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const OFFICE_INACTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const PASSWORD = 'Password123!';

// A stand-in for the Catalogue service: same answers, no network.
export const catalogue = {
  down: false,
  offices: new Map([
    [OFFICE_A, { is_active: true }],
    [OFFICE_B, { is_active: true }],
    [OFFICE_INACTIVE, { is_active: false }],
  ]),
};

export const mail = { sent: [], failNext: false };

export async function setupTestEnv() {
  process.env.SERVICE_KEY = 'test-service-key-0123456789';
  delete process.env.JWT_PRIVATE_KEY; // a temporary signing key is generated for the test run

  setOfficeVerifier(async (officeId) => {
    if (catalogue.down) throw Errors.unavailable(OFFICE_UNREACHABLE, 'OFFICE_CHECK_UNAVAILABLE');
    if (!catalogue.offices.get(officeId)?.is_active) {
      throw Errors.badRequest(OFFICE_INVALID, { office_id: OFFICE_INVALID }, 'OFFICE_INVALID');
    }
    return { office_id: officeId, is_active: true };
  });
  setMailer(async (message) => {
    if (mail.failNext) {
      mail.failNext = false;
      throw new Error('mail provider down');
    }
    mail.sent.push(message);
  });

  const testDb = await createTestDatabase({ entities, afterSync });
  setDataSource(testDb.dataSource);
  return {
    ds: testDb.dataSource,
    async cleanup() {
      setDataSource(null);
      setOfficeVerifier(null);
      setMailer(null);
      await testDb.drop();
    },
  };
}

let counter = 0;
export async function seedAccount(ds, { role = ROLES.OFFICE_STAFF, officeId, email, password = PASSWORD, active = true, fullName, employeeNo } = {}) {
  counter += 1;
  const resolvedOffice = officeId === undefined ? (role === ROLES.OFFICE_HEAD || role === ROLES.OFFICE_STAFF ? OFFICE_A : null) : officeId;
  return ds.getRepository(Account).save({
    accountId: randomUUID(),
    employeeNo: employeeNo ?? `EMP-${1000 + counter}`,
    fullName: fullName ?? `Test User ${counter}`,
    email: email ?? `user${counter}@pup.edu.ph`,
    passwordHash: await hashPassword(password),
    roleKey: role,
    officeId: resolvedOffice,
    isActive: active,
  });
}

export const tokenFor = (account) => signAccessToken(account);

export function req(method, path, { token, body, headers, cookie } = {}) {
  return new Request(`http://localhost/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const ctx = (id) => ({ params: Promise.resolve({ id }) });

/** The refresh token value from a response's Set-Cookie header (or null). */
export function refreshTokenFrom(response) {
  const header = response.headers.get('set-cookie') ?? '';
  const match = /ccms_refresh=([^;]*)/.exec(header);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
}

export const outboxEvents = async (ds, action) =>
  (await ds.query(`SELECT payload FROM audit_outbox WHERE payload->>'action' = $1 ORDER BY created_at`, [action])).map((r) => r.payload);
