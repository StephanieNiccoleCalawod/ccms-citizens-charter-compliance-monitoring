import { randomUUID } from 'node:crypto';
import { Errors, recordAudit } from 'ccms-shared';
import { kickOutbox } from '../../lib/outbox.js';

const INCOMING = `SELECT * FROM jsonb_to_recordset($1::jsonb) AS incoming(
  student_number varchar(30), full_name varchar(200), program varchar(20), year_level smallint,
  status varchar(8), valid_until date, email varchar(254)
)`;
const fields = (alias) => `ROW(${alias}.full_name, ${alias}.program, ${alias}.year_level,
  ${alias}.status, ${alias}.valid_until, ${alias}.email)`;

async function countChanges(manager, payload, total) {
  const [counts] = await manager.query(
    `SELECT
       count(*) FILTER (WHERE p.student_number IS NULL)::int AS added,
       count(*) FILTER (WHERE p.student_number IS NOT NULL
         AND ${fields('p')} IS DISTINCT FROM ${fields('i')})::int AS updated
     FROM (${INCOMING}) i LEFT JOIN registry_people p USING (student_number)`,
    [payload],
  );
  return { total, added: counts.added, updated: counts.updated, unchanged: total - counts.added - counts.updated };
}

export async function importRegistry(dataSource, actor, batch, { dryRun, ipAddress } = {}) {
  const { total, people, errors } = batch;
  if (errors.length) {
    const details = { total, added: 0, updated: 0, invalid: errors.length, errors };
    if (dryRun) return { ...details, status: 'INVALID' };
    throw Errors.badRequest('Correct the listed rows and check the file again.', details, 'REGISTRY_INVALID_ROWS');
  }

  const payload = JSON.stringify(people);
  try {
    if (dryRun) return { ...await countChanges(dataSource, payload, total), invalid: 0, errors: [] };

    const result = await dataSource.transaction(async (manager) => {
      // Serialize registry writers so the counts, records and audit all describe the same import.
      await manager.query('LOCK TABLE registry_people IN SHARE ROW EXCLUSIVE MODE');
      const counts = await countChanges(manager, payload, total);
      const importId = randomUUID();
      await manager.query(
        'INSERT INTO registry_imports (import_id, rows, added, updated, unchanged) VALUES ($1, $2, $3, $4, $5)',
        [importId, total, counts.added, counts.updated, counts.unchanged],
      );
      await manager.query(
        `INSERT INTO registry_people
           (student_number, full_name, program, year_level, status, valid_until, email, last_import_id)
         SELECT i.student_number, i.full_name, i.program, i.year_level, i.status, i.valid_until, i.email, $2
         FROM (${INCOMING}) i
         ON CONFLICT (student_number) DO UPDATE SET
           full_name = EXCLUDED.full_name, program = EXCLUDED.program, year_level = EXCLUDED.year_level,
           status = EXCLUDED.status, valid_until = EXCLUDED.valid_until, email = EXCLUDED.email,
           last_import_id = EXCLUDED.last_import_id, updated_at = now()
         WHERE ${fields('registry_people')} IS DISTINCT FROM ${fields('EXCLUDED')}`,
        [payload, importId],
      );
      await recordAudit(manager, {
        actor,
        action: 'REGISTRY_IMPORTED',
        entityType: 'registry_import',
        entityId: importId,
        after: { rows: total, added: counts.added, updated: counts.updated },
        ipAddress,
      });
      return { import_id: importId, ...counts, invalid: 0, errors: [] };
    });
    kickOutbox();
    return result;
  } catch {
    // Database errors can carry query parameters. Keep registry values out of the error logger.
    throw Errors.unavailable('The registry could not be accessed. Please try again.', 'REGISTRY_UNAVAILABLE');
  }
}

export async function listRegistryImports(dataSource) {
  const items = await dataSource.query(
    `SELECT import_id, rows AS total, added, updated, unchanged, created_at
     FROM registry_imports ORDER BY created_at DESC, import_id DESC`,
  );
  return { items, total: items.length };
}

export async function getRegistrySummary(dataSource) {
  const programs = await dataSource.query(
    `SELECT program, count(*)::int AS total,
       count(*) FILTER (WHERE status = 'ENROLLED')::int AS enrolled,
       count(*) FILTER (WHERE status = 'ALUMNI')::int AS alumni
     FROM registry_people GROUP BY program ORDER BY program`,
  );
  const totals = { total: 0, enrolled: 0, alumni: 0 };
  for (const program of programs) {
    totals.total += program.total;
    totals.enrolled += program.enrolled;
    totals.alumni += program.alumni;
  }
  return { ...totals, by_program: programs };
}
