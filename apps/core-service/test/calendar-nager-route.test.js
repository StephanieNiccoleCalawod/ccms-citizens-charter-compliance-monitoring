import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ROLES, setDefaultVerifier } from 'ccms-shared';
import { GET } from '../src/app/api/holidays/nager/route.js';

const url = 'http://localhost/api/holidays/nager';
const adminHeaders = { authorization: 'Bearer test-admin' };

afterEach(() => setDefaultVerifier(undefined));

test('the reference feed requires sign-in and skips provider calls for unverified years', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.equal((await GET(new Request(`${url}?year=2026`))).status, 401);

  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  assert.equal((await GET(new Request(`${url}?year=2201`, { headers: adminHeaders }))).status, 400);
  const uncovered = await GET(new Request(`${url}?year=2028`, { headers: adminHeaders }));
  assert.equal(uncovered.status, 200);
  assert.deepEqual(await uncovered.json(), { year: 2028, verified: false, items: [] });
  assert.equal(provider.mock.callCount(), 0);
});

test('staff see only nationwide Nager.Date holidays that match the official calendar, with the official type', async (t) => {
  setDefaultVerifier(async () => ({ id: 'staff', role: ROLES.OFFICE_STAFF }));
  const holiday = { date: '2026-11-30', name: 'Provider name', countryCode: 'PH', nationalHoliday: true, holidayTypes: ['Public'] };
  t.mock.method(globalThis, 'fetch', async (endpoint) => {
    assert.equal(endpoint, 'https://nagerholidays.com/api/v4/Holidays/PH/2026');
    return Response.json([
      holiday,
      holiday,
      { ...holiday, date: '2026-12-08' },
      { ...holiday, date: '2026-10-31' },
      { ...holiday, date: '2026-02-25' },
      { ...holiday, date: '2026-01-01', countryCode: 'US' },
      { ...holiday, date: '2026-04-09', nationalHoliday: false },
      { ...holiday, date: '2026-05-01', holidayTypes: ['Observance'] },
      { ...holiday, date: '2025-11-30' },
      { ...holiday, date: '2026-02-30' },
      null,
    ]);
  });

  const response = await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    year: 2026, verified: true, items: [
      { date: '2026-11-30', name: 'Bonifacio Day', type: 'REGULAR_HOLIDAY' },
      { date: '2026-12-08', name: 'Feast of the Immaculate Conception', type: 'SPECIAL_NON_WORKING' },
    ],
  });
});

test('a provider failure returns a retryable error without changing the calendar', async (t) => {
  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const response = await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'HOLIDAY_SOURCE_UNAVAILABLE');
});
