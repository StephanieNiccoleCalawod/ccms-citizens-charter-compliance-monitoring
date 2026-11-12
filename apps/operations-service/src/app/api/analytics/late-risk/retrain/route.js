import { ROLES, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../lib/data-source.js';
import { trainLateRisk } from '../../../../../modules/analytics/late-risk.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const canRetrain = requirePermission([ROLES.SUPER_ADMIN], 'campus');

export const POST = route(async (request) => {
  await canRetrain(request);
  const result = await trainLateRisk(await getDb());
  return json(result, result.running ? 202 : 200);
});
