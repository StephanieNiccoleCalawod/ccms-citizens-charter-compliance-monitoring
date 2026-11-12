import { json, requireServiceKey, route } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';

export const dynamic = 'force-dynamic';

// GET /internal/seed-catalogue — service-to-service only (x-service-key); the gateway never forwards /api/internal.
// Sprint 6 TT1: the historical-records import (Operations scripts/seed-transactions.js) reads the catalogue it plans
// against from here: every office, every service with its CC047 allowed client types, and every standard version with its
// effective range. Read only, no personal data, nothing cached. Ordered by codes so the planner's input is stable.
export const GET = route(async (request) => {
  requireServiceKey(request);
  const db = await getDb();
  const offices = await db.query(
    'SELECT office_id, office_code, office_name, is_active FROM offices ORDER BY office_code, office_id',
  );
  const services = await db.query(
    `SELECT service_id, office_id, service_code, service_name, classification, allowed_client_types, is_active
       FROM services ORDER BY service_code, service_id`,
  );
  const standards = await db.query(
    `SELECT standard_id, service_id, effective_from::text AS effective_from, effective_to::text AS effective_to,
            duration_days, duration_hours, duration_minutes
       FROM service_standards ORDER BY service_id, effective_from, standard_id`,
  );
  return json({ offices, services, standards }, 200, { 'cache-control': 'no-store' });
});
