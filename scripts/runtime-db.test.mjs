import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDataSource } from 'ccms-shared';

for (const service of ['identity-service', 'core-service', 'operations-service', 'oversight-service']) {
  test(`${service} runtime disables schema synchronization despite environment opt-in`, async () => {
    const previous = process.env.DB_SYNCHRONIZE;
    process.env.DB_SYNCHRONIZE = 'true';
    try {
      const { dbOptions } = await import(`../apps/${service}/src/lib/data-source.js`);
      assert.equal(dbOptions.synchronize, false);
      const source = createDataSource({ ...dbOptions, url: 'postgres://unused@127.0.0.1:1/unused' });
      assert.equal(source.options.synchronize, false);
      assert.equal(source.options.installExtensions, false);
      // Explicit administrative commands retain their intentional override.
      assert.equal({ ...dbOptions, synchronize: true }.synchronize, true);
    } finally {
      if (previous === undefined) delete process.env.DB_SYNCHRONIZE;
      else process.env.DB_SYNCHRONIZE = previous;
    }
  });
}
