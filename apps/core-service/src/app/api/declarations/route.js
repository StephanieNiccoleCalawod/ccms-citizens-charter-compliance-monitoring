import { Errors, json, route } from 'ccms-shared';
import { getDb } from '../../../lib/data-source.js';
import { listDeclarations, listFmsDeclarations, termRange } from '../../../lib/calendar/declarations.js';
import { requireMachineKey } from '../../../lib/machine-keys.js';

export const dynamic = 'force-dynamic';

// GET /declarations?fromDate=YYYY-MM-DD&untilDate=YYYY-MM-DD&cursor=&limit= (EB6, FMS: schema 3 snapshot pages), or
// ?term=2026-1S / ?from=&to= with an SMS key (cal-1.0). The pull snapshot: every calendar entry in the range, removals
// included, in the shape of a pushed message. Machine key only (EB7):
// `Authorization: Bearer ccms_mk_...` with the read-calendar scope, issued to FMS or to SMS (any other key, a signed-in
// user's token and the shared service key are all refused with 401). ?term= is for SMS keys only (an FMS key gets 403).
export const GET = route(async (request) => {
  const db = await getDb();
  const { caller } = await requireMachineKey(request, db, 'read-calendar', ['FMS', 'SMS']);
  const query = Object.fromEntries(new URL(request.url).searchParams);
  if (caller === 'FMS') {
    if (query.term !== undefined) throw Errors.forbidden('This key cannot read a calendar by term', 'TERM_QUERY_NOT_ALLOWED');
    return json(await listFmsDeclarations(db, query));
  }
  if (query.term !== undefined) {
    if (query.from !== undefined || query.to !== undefined) {
      throw Errors.validation('Use term or from/to, not both', { term: 'Use term or from/to, not both' });
    }
    Object.assign(query, await termRange(db, query.term));
  }
  return json(await listDeclarations(db, query));
});
