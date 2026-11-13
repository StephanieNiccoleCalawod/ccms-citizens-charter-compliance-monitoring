import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Clerk sign-in (Landas 1): account_clerk_links (account <-> Clerk issuer + user ID) and clerk_access_requests (signed in,
// not bound yet). Two new tables; accounts is untouched. Expected catalog definitions are frozen in
// clerk-links-schema.json (taken from a database built by the .up.sql file).
const expected = JSON.parse(readFileSync(new URL('./clerk-links-schema.json', import.meta.url), 'utf8'));

export class ClerkAccountLinks1795100000000 {
  name = 'ClerkAccountLinks1795100000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return; // already there and identical (built by db:sync)
    await runner.query(readFileSync(new URL('./sql/1795100000000-ClerkAccountLinks.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Dropping the links signs every Clerk user out of CCMS until a Super Admin binds them again: back up first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['account_clerk_links', 'clerk_access_requests']);
    await runner.query('DROP TABLE IF EXISTS clerk_access_requests');
    await runner.query('DROP TABLE IF EXISTS account_clerk_links');
  }
}
