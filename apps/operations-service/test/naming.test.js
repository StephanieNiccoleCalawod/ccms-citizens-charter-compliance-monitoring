import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
// Built from parts so this file does not itself contain the old prefix.
const OLD_PREFIX = ['ccc', 'ms-'].join('');

describe('naming convention (TT1 AC5)', () => {
  it('uses ccms-{name}-service and ccms_{name}, never the old prefix', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.name, 'ccms-operations-service');
    assert.equal(pkg.name, `ccms-${pkg.ccms.service}-service`);
    for (const file of ['package.json', '.env.example', 'README.md', 'next.config.js']) {
      assert.ok(!read(file).includes(OLD_PREFIX), `${file} uses the old prefix`);
    }
    assert.ok(read('.env.example').includes('/ccms_operations'), 'database name should be ccms_operations');
  });

  it('owns only its own database: no other service credentials are named in the environment example (TT1 AC4)', () => {
    const env = read('.env.example');
    for (const other of ['ccms_identity', 'ccms_core', 'ccms_oversight', 'ccms_logs_writer']) {
      assert.ok(!env.includes(other), `.env.example mentions ${other}`);
    }
    assert.equal((env.match(/^DATABASE_URL=/gm) ?? []).length, 1, 'exactly one database connection');
  });

  it('the root lock file records the named workspace and its local link', () => {
    const lock = JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8'));
    assert.equal(lock.name, 'ccms-monorepo');
    assert.equal(lock.packages['apps/operations-service'].name, 'ccms-operations-service');
    assert.deepEqual(lock.packages['node_modules/ccms-operations-service'], { resolved: 'apps/operations-service', link: true });
  });
});
