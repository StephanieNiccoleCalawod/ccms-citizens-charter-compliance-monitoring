import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ROLES, setDefaultVerifier } from 'ccms-shared';
import { GET } from '../src/app/api/holidays/nager/route.js';

const url = 'http://localhost/api/holidays/nager';
const adminHeaders = { authorization: 'Bearer test-admin' };

afterEach(() => setDefaultVerifier(undefined));

test('only a Super Admin can query the provider and an invalid year stays local', async (t) => {
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json([]));
  assert.equal((await GET(new Request(`${url}?year=2026`))).status, 401);

  setDefaultVerifier(async () => ({ id: 'staff', role: ROLES.OFFICE_STAFF }));
  assert.equal((await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }))).status, 403);

  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  assert.equal((await GET(new Request(`${url}?year=2201`, { headers: adminHeaders }))).status, 400);
  assert.equal(provider.mock.callCount(), 0);
});

test('the preview uses Nager.Date v4 and returns only nationwide public holidays for the requested year', async (t) => {
  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  const holiday = { date: '2026-11-30', name: ' Bonifacio Day ', countryCode: 'PH', nationalHoliday: true, holidayTypes: ['Public'] };
  t.mock.method(globalThis, 'fetch', async (endpoint) => {
    assert.equal(endpoint, 'https://nagerholidays.com/api/v4/Holidays/PH/2026');
    return Response.json([
      holiday,
      { ...holiday, countryCode: 'US' },
      { ...holiday, nationalHoliday: false },
      { ...holiday, holidayTypes: ['Observance'] },
      { ...holiday, date: '2025-11-30' },
      { ...holiday, date: '2026-02-30' },
      null,
    ]);
  });

  const response = await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { year: 2026, items: [{ date: '2026-11-30', name: 'Bonifacio Day' }] });
});

test('a provider failure returns a retryable error without changing the calendar', async (t) => {
  setDefaultVerifier(async () => ({ id: 'admin', role: ROLES.SUPER_ADMIN }));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const response = await GET(new Request(`${url}?year=2026`, { headers: adminHeaders }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'HOLIDAY_SOURCE_UNAVAILABLE');
});
