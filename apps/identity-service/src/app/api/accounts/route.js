import { ROLES, clientIp, json, readJson, route } from 'ccms-shared';
import { createAccount, listAccounts } from '../../../lib/accounts.js';
import { getDb } from '../../../lib/data-source.js';
import { guard } from '../../../lib/guard.js';

export const dynamic = 'force-dynamic';

const superAdminOnly = guard([ROLES.SUPER_ADMIN]);

// GET /accounts?q=&role=&office_id=&status=&page=&page_size= — Super Admin only.
export const GET = route(async (request) => {
  await superAdminOnly(request);
  const params = new URL(request.url).searchParams;
  const result = await listAccounts(await getDb(), {
    q: params.get('q'),
    role: params.get('role') || undefined,
    officeId: params.get('office_id') || undefined,
    status: params.get('status') || undefined,
    page: params.get('page') || undefined,
    pageSize: params.get('page_size') || undefined,
  });
  return json(result);
});

// POST /accounts — Super Admin only.
export const POST = route(async (request, { correlationId }) => {
  const user = await superAdminOnly(request);
  const account = await createAccount(await getDb(), user, await readJson(request), {
    ipAddress: clientIp(request),
    correlationId,
  });
  return json({ account }, 201);
});
