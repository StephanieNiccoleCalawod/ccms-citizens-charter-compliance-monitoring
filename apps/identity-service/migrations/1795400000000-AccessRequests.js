import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// S8-52 Request Access: access_requests and account_permission_grants (two new tables; nothing existing is touched). Expected catalog
// definitions are frozen in access-requests-schema.json (taken from a database built by the .up.sql file).
const expected = JSON.parse(readFileSync(new URL('./access-requests-schema.json', import.meta.url), 'utf8'));

export class AccessRequests1795400000000 {
  name = 'AccessRequests1795400000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return; // already there and identical (built by db:sync)
    await runner.query(readFileSync(new URL('./sql/1795400000000-AccessRequests.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Dropping the tables removes who asked for what and the active grants: back up first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['account_permission_grants', 'access_requests']);
    await runner.query('DROP TABLE IF EXISTS account_permission_grants');
    await runner.query('DROP TABLE IF EXISTS access_requests');
  }
}
