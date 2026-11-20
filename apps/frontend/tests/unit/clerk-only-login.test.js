// Clerk-only production sign-in (Phase 1 + the Clerk-page redesign). Source-level checks, like the other structure tests:
// the production build redirects /login to the Clerk flow, the Clerk page wears the shared sign-in design, and no sign-in
// method the owner enabled (Google in particular) is ever hidden. Local and QA (legacy/dual) keep the password page.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { authProvider, clerkEnabled, signInPath } from '../../src/lib/auth/provider.js';

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(root(p), 'utf8');

describe('Clerk-only production sign-in', () => {
  it('next.config redirects /login to /login/clerk only in clerk mode, and never caches the redirect', () => {
    const cfg = read('next.config.js');
    assert.match(cfg, /async redirects\(\)/);
    assert.match(cfg, /source: '\/login'/);
    assert.match(cfg, /destination: '\/login\/clerk'/);
    assert.match(cfg, /permanent: false/);
    // Gated on clerk mode + a publishable key, so legacy/dual (local, QA) still serve the password page.
    assert.match(cfg, /provider !== 'clerk'/);
    assert.match(cfg, /pk_\(test\|live\)_/);
  });

  it('signInPath points programmatic navigation at the Clerk page in clerk mode and the password page otherwise', () => {
    // These read build-time NEXT_PUBLIC_* env; with none set the default is legacy.
    assert.equal(authProvider(), 'legacy');
    assert.equal(clerkEnabled(), false);
    assert.equal(signInPath(), '/login');
  });

  it('the Clerk sign-in page wears the shared design and keeps every sign-in method (Google included)', () => {
    const page = read('src/app/login/clerk/[[...rest]]/page.js');
    assert.ok(page.includes('AuthBrandPanel'), 'uses the shared campus-photo panel');
    assert.match(page, /<SignIn\s+routing="path"/, 'renders Clerk SignIn with path routing');
    // The owner enables Google; the page must not hide social buttons through a Clerk appearance override.
    assert.doesNotMatch(page, /socialButtons[^}]*display:\s*['"]?none/i);
    assert.doesNotMatch(page, /socialButtons[^}]*hidden/i);
    // Dual mode (local/QA) keeps the escape hatch to the password form; production (clerk) shows "Staff sign-in only" instead.
    assert.match(page, /authProvider\(\) === 'dual'/);
    assert.ok(page.includes('Sign in with email and password'));
  });

  it('both sign-in pages share one campus-photo panel component', () => {
    assert.ok(read('src/app/login/page.js').includes('AuthBrandPanel'), 'password page uses the shared panel');
    assert.ok(read('src/app/login/page.js').includes("from '../../components/auth/AuthBrandPanel.js'"));
    const panel = read('src/components/auth/AuthBrandPanel.js');
    assert.match(panel, /src="\/Background\.jpg"/);
    assert.ok(!panel.includes("'use client'"), 'the panel is presentational, no client hooks');
  });
});
