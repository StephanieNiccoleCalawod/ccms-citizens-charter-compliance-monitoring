import { readFileSync } from 'node:fs';
import { assertNewTablesCompatible, assertTablesEmptyBeforeDrop } from 'ccms-shared';

// Clerk sign-in, Flow A: clerk_invitations (invitations CCCMS sent, with the hashed opaque reference that binds the account
// on first sign-in). One new table; accounts and account_clerk_links are untouched. Expected catalog definitions are frozen
// in clerk-invitations-schema.json (taken from a database built by the .up.sql file).
const expected = JSON.parse(readFileSync(new URL('./clerk-invitations-schema.json', import.meta.url), 'utf8'));

export class ClerkInvitations1795300000000 {
  name = 'ClerkInvitations1795300000000';

  async up(runner) {
    if (await assertNewTablesCompatible(runner, expected)) return; // already there and identical (built by db:sync)
    await runner.query(readFileSync(new URL('./sql/1795300000000-ClerkInvitations.up.sql', import.meta.url), 'utf8'));
  }

  async down(runner) {
    // Dropping open invitations means invited people land on "No access yet" instead of being linked: back up first.
    await assertTablesEmptyBeforeDrop(runner, this.name, ['clerk_invitations']);
    await runner.query('DROP TABLE IF EXISTS clerk_invitations');
  }
}
