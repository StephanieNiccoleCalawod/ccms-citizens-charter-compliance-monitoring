import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ROLES, setDefaultVerifier } from 'ccms-shared';
import { GET } from '../src/app/api/holidays/nager/route.js';

const url = 'http://localhost/api/holidays/nager';
const adminHeaders = { authorization: 'Bearer test-admin' };

afterEach(() => setDefaultVerifier(undefined));

test('the reference feed requires sign-in and validates the requested year before calling Nager.Date', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.equal((await GET(new Request(`${url}?year=2026`))).status, 401);

  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  assert.equal((await GET(new Request(`${url}?year=2201`, { headers: adminHeaders }))).status, 400);
  assert.equal(provider.mock.callCount(), 0);
});

test('staff see nationwide public holidays directly from Nager.Date for a future year', async (t) => {
  setDefaultVerifier(async () => ({ id: 'staff', role: ROLES.OFFICE_STAFF }));
  const holiday = { date: '2028-11-30', name: 'Bonifacio Day', countryCode: 'PH', nationalHoliday: true, holidayTypes: ['Public'] };
  t.mock.method(globalThis, 'fetch', async (endpoint) => {
    assert.equal(endpoint, 'https://nagerholidays.com/api/v4/Holidays/PH/2028');
    return Response.json([
      holiday,
      holiday,
      { ...holiday, date: '2028-10-31', name: 'All Saints’ Day Eve' },
      { ...holiday, date: '2028-01-01', countryCode: 'US' },
      { ...holiday, date: '2028-04-09', nationalHoliday: false },
      { ...holiday, date: '2028-05-01', holidayTypes: ['Observance'] },
      { ...holiday, date: '2027-11-30' },
      { ...holiday, date: '2028-02-30' },
      null,
    ]);
  });

  const response = await GET(new Request(`${url}?year=2028`, { headers: adminHeaders }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    year: 2028, available: true, items: [
      { date: '2028-11-30', name: 'Bonifacio Day' },
      { date: '2028-10-31', name: 'All Saints’ Day Eve' },
    ],
  });
});

test('a year outside the provider’s coverage returns an empty calendar feed', async (t) => {
  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 400 }));
  const response = await GET(new Request(`${url}?year=2200`, { headers: adminHeaders }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { year: 2200, available: false, items: [] });
});

test('a provider failure returns a retryable error without changing the calendar', async (t) => {
  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const response = await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'HOLIDAY_SOURCE_UNAVAILABLE');
});
