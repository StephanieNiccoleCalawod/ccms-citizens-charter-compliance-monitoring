import { ROLES, clientIp, json, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { parseRegistryFile, readRegistryUpload } from '../../../../modules/registry/file.js';
import { importRegistry, listRegistryImports } from '../../../../modules/registry/imports.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const canManage = requirePermission([ROLES.SUPER_ADMIN]);

export const GET = route(async (request) => {
  await canManage(request);
  return json(await listRegistryImports(await getDb()));
});

export const POST = route(async (request) => {
  const actor = await canManage(request);
  const { file, extension, dryRun } = await readRegistryUpload(request);
  const batch = await parseRegistryFile(file, extension);
  const result = await importRegistry(await getDb(), actor, batch, { dryRun, ipAddress: clientIp(request) });
  return json(result, dryRun ? 200 : 201);
});
