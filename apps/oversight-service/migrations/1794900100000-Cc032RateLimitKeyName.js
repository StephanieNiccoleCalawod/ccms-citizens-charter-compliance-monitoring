import { assertMigrationObjects } from 'ccms-shared';

const LEGACY = 'rate_limit_hits_pkey';
const CURRENT = 'PK_d392e81d922afbaed7efb3f1184';
const PRIMARY_KEY = 'PRIMARY KEY (key)';
const constraint = (name) => `constraint:rate_limit_hits.${name}`;
const EXPECTED = { [constraint(LEGACY)]: PRIMARY_KEY, [constraint(CURRENT)]: PRIMARY_KEY };

async function renamePrimaryKey(runner, from, to) {
  await runner.query('LOCK TABLE public.rate_limit_hits IN ACCESS EXCLUSIVE MODE');
  const actual = await assertMigrationObjects(runner, EXPECTED);
  if (actual[constraint(to)] === PRIMARY_KEY) return;
  if (actual[constraint(from)] !== PRIMARY_KEY) {
    throw new Error(`Unexpected primary key on public.rate_limit_hits; expected "${from}" or "${to}" on (key).`);
  }
  await runner.query(`ALTER TABLE public.rate_limit_hits RENAME CONSTRAINT "${from}" TO "${to}"`);
}

export class Cc032RateLimitKeyName1794900100000 {
  name = 'Cc032RateLimitKeyName1794900100000';

  async up(runner) {
    await renamePrimaryKey(runner, LEGACY, CURRENT);
  }

  async down(runner) {
    await renamePrimaryKey(runner, CURRENT, LEGACY);
  }
}
