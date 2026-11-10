import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runMigrationCli } from 'ccms-shared';

test('Neon transaction-pool endpoints refuse migration writes before connecting', async () => {
  for (const command of ['run', 'baseline', 'revert']) {
    let connected = false;
    await assert.rejects(runMigrationCli({
      service: 'guard-test',
      argv: [command, '--confirm=example'],
      env: { DB_TARGET: 'hosted', DATABASE_URL: 'postgres://unused@ep-example-pooler.region.aws.neon.tech/example' },
      baseline: { name: 'Unused1793491200000', schema: {} },
      createSource: () => { connected = true; throw new Error('Must not connect'); },
      log: () => {},
    }), /direct Neon connection/);
    assert.equal(connected, false);
  }
});
