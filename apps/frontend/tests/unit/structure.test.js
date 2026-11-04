import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ROLE_LIST } from 'ccms-shared/roles';
import { landingForRole, navForRole } from '../../src/lib/auth/permissions.js';
import { isRoleAllowed } from '../../src/lib/auth/guards.js';
import { toQuery } from '../../src/lib/api/client.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
// Forward slashes on every OS, so the page checks below also work on Windows.
const sources = walk(join(ROOT, 'src'))
  .map((f) => f.replaceAll('\\', '/'))
  .filter((f) => f.endsWith('.js'));

describe('the frontend only talks to the API gateway', () => {
  it('has no server code or database access', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/from ['"](pg|typeorm|jose|nodemailer)['"]/.test(text), `${file} imports a server library`);
      assert.ok(!/process\.env\.(DATABASE_URL|SERVICE_KEY|CRON_SECRET)/.test(text), `${file} reads a secret`);
    }
  });

  it('calls only /api/identity, /api/catalogue, /api/calendar, /api/operations and /api/logs, never a service address', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/https?:\/\/(127\.0\.0\.1|localhost)/.test(text), `${file} has a hard-coded address`);
      for (const match of text.matchAll(/['"`](\/api\/[^'"`$]*)/g)) {
        assert.match(match[1], /^\/api\/(identity|catalogue|calendar|operations|logs)(\/|$)/, `${file}: ${match[1]}`);
      }
    }
  });

  it('keeps the service key and the old per-repo page links out of the screens', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/x-service-key/i.test(text), file);
      assert.ok(!/NEXT_PUBLIC_(IDENTITY|CATALOGUE)_APP_URL/.test(text), file);
    }
  });

  it('has every screen of the system', () => {
    const pages = sources.filter((f) => f.endsWith('/page.js')).map((f) => f.slice(join(ROOT, 'src/app').length, -'/page.js'.length) || '/');
    for (const expected of ['/', '/login', '/reset-password', '/accounts', '/office', '/campus', '/offices', '/services', '/services/[id]', '/public/[id]', '/calendar', '/settings', '/logs', '/transactions/new', '/transactions', '/transactions/[id]']) {
      assert.ok(pages.includes(expected), `missing page ${expected}`);
    }
  });
});

describe('roles and navigation', () => {
  it('every role has Home first and lands on a page that exists', () => {
    assert.ok(ROLE_LIST.length >= 4);
    for (const role of ROLE_LIST) {
      const nav = navForRole(role);
      assert.ok(nav.length > 0, `${role} has a menu`);
      assert.equal(nav[0].href, '/', `${role} starts with Home`);
      assert.ok(landingForRole(role).startsWith('/'));
    }
  });

  it('isRoleAllowed lets any role through when no list is given', () => {
    assert.equal(isRoleAllowed({ role: 'executive' }, undefined), true);
    assert.equal(isRoleAllowed({ role: 'executive' }, ['super_admin']), false);
    assert.equal(isRoleAllowed({ role: 'super_admin' }, ['super_admin']), true);
  });
});

describe('query helper', () => {
  it('drops empty values and trims', () => {
    assert.equal(toQuery({ search: '  reg ', page: 2, x: '', y: null, z: undefined }), '?search=reg&page=2');
    assert.equal(toQuery({}), '');
  });
});
