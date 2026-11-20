// S8-29 / S8-30. Read-only inventory and the Clerk cutover of one account (dry run unless --apply).
//   npm run clerk:inventory                       prints the summary and writes nothing
//   npm run clerk:cutover -- <account-uuid>       shows what would change
//   npm run clerk:cutover -- <account-uuid> --apply   needs CUTOVER_ACTOR_ACCOUNT_ID (the Super Admin doing it) and a backup first
// A hosted database is only touched by BE Dev 1 / the PM after a backup and approval (D8-11); this script never creates tables.
import { getDataSource } from 'ccms-shared';
import { cutoverAccount, inventoryAccounts, summarize } from '../src/lib/clerk-cutover.js';
import { dbOptions } from '../src/lib/data-source.js';

const [command, ...rest] = process.argv.slice(2);
const dataSource = await getDataSource({ ...dbOptions, synchronize: false });
try {
  if (command === 'inventory') {
    const list = await inventoryAccounts(dataSource);
    console.log(JSON.stringify({ total: list.length, summary: summarize(list), accounts: list }, null, 2));
  } else if (command === 'cutover') {
    const apply = rest.includes('--apply');
    const accountId = rest.find((a) => !a.startsWith('--'));
    let actor;
    if (apply) {
      const id = process.env.CUTOVER_ACTOR_ACCOUNT_ID;
      const row = id && (await dataSource.query('SELECT account_id, role_key FROM accounts WHERE account_id = $1 AND is_active', [id]))[0];
      if (!row || row.role_key !== 'super_admin') throw new Error('Set CUTOVER_ACTOR_ACCOUNT_ID to an active Super Admin account ID.');
      actor = { id: row.account_id, role: row.role_key };
    }
    console.log(JSON.stringify(await cutoverAccount(dataSource, accountId, { actor, apply, ipAddress: null }), null, 2));
  } else {
    throw new Error('Use: inventory | cutover <account-uuid> [--apply]');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await dataSource.destroy();
}
