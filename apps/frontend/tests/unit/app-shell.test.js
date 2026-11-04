import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

describe('the shared app shell: header and sidebar (source checks, not a browser)', () => {
  const shell = read('src/components/layout/AppShell.js');
  it('is the one shell every signed-in page uses, and there is a single header and a single sidebar in it', () => {
    assert.equal([...shell.matchAll(/<header /g)].length, 1);
    assert.equal([...shell.matchAll(/<aside/g)].length, 1);
    for (const page of ['src/app/accounts/page.js', 'src/app/services/page.js', 'src/app/transactions/page.js', 'src/app/offices/page.js', 'src/app/logs/page.js']) {
      assert.ok(read(page).includes('<AppShell'), page);
    }
  });
  it('the circular floating back/collapse button is gone and a hamburger button is at the start of the header', () => {
    assert.ok(!shell.includes('absolute -right-4 top-5'));
    assert.ok(!shell.includes('rounded-full bg-white text-[#3D0606] shadow-md'));
    const header = shell.slice(shell.indexOf('<header '));
    assert.ok(header.indexOf('M4 7h16M4 12h16M4 17h16') > 0 && header.indexOf('M4 7h16M4 12h16M4 17h16') < header.indexOf('<RowActionMenu'));
    assert.ok(header.indexOf('M4 7h16M4 12h16M4 17h16') < header.indexOf('{title}'), 'the title comes after the hamburger');
  });
  it('the hamburger collapses the sidebar to icons from md up and opens a drawer below that, and says which in its label', () => {
    assert.ok(shell.includes('onClick={wide ? toggleCollapsed : () => setMenuOpen((open) => !open)}'));
    assert.ok(shell.includes("const WIDE_QUERY = '(min-width: 768px)'"));
    assert.ok(shell.includes("wide ? (collapsed ? 'Expand sidebar' : 'Collapse sidebar') : menuOpen ? 'Close navigation' : 'Open navigation'"));
    assert.ok(shell.includes('aria-controls="app-sidebar"'));
  });
  it('collapsed means icons only with tooltips (title) and screen-reader labels, and the width change is a short transition', () => {
    assert.ok(shell.includes('const iconOnly = collapsed && wide;'));
    assert.ok(shell.includes("iconOnly ? 'md:w-[72px]' : 'md:w-64'"));
    assert.ok(shell.includes('title={item.label}'));
    assert.ok(shell.includes('<span className="sr-only">{item.label}</span>'));
    assert.ok(shell.includes('transition-[transform,width] duration-200'));
  });
  it('the phone drawer has a backdrop, closes on Escape, on choosing a page, and is not focusable while closed', () => {
    assert.ok(shell.includes('fixed inset-0 z-30 bg-slate-900/40'));
    assert.ok(shell.includes("event.key === 'Escape' && setMenuOpen(false)"));
    assert.ok(shell.includes('onClick={() => setMenuOpen(false)}'));
    assert.ok(shell.includes("drawerHidden ? 'invisible md:visible' : ''"));
  });
  it('the page content sits beside the sidebar and the header is a plain 64px bar aligned with the sidebar logo bar', () => {
    assert.ok(shell.includes('min-h-screen bg-white md:flex'));
    assert.ok(shell.includes('flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white'));
    assert.ok(shell.includes('flex h-16 shrink-0 border-b border-white/10 bg-[#3D0606]'));
  });
  it('keeps the CCMS branding and the dynamic user details, role-based navigation and Sign out', () => {
    assert.ok(shell.includes('{BRAND.campus}') && shell.includes('{BRAND.system}') && shell.includes('<BrandMark'));
    assert.ok(shell.includes('{user.fullName}') && shell.includes('ROLE_LABELS[user.role]') && shell.includes('initials(user.fullName)'));
    assert.ok(shell.includes('appNavForRole(user.role)'));
    assert.ok(shell.includes("label: signOutControl.busy ? 'Signing out…' : 'Sign out'"));
  });
  it('the sidebar rhythm follows the reference: 38px items on a 40px pitch, 14px side padding, 16px between icon and label, 18px icons, 24px between groups, headings aligned with the icons, and no space-between spreading', () => {
    assert.ok(shell.includes('space-y-6 py-5'));
    assert.ok(shell.includes('<ul className="space-y-0.5">'));
    assert.ok(shell.includes('group relative flex h-[38px] items-center rounded-lg text-sm font-medium'));
    assert.ok(shell.includes("'w-full px-3.5'"));
    assert.ok(shell.includes('<span className="flex min-w-0 items-center gap-4">'));
    assert.ok(read('src/components/layout/NavIcon.js').includes('h-[18px] w-[18px]'));
    assert.ok(shell.includes('mb-4 px-3.5 text-[10px] font-bold uppercase leading-4 tracking-[0.12em]'));
    assert.ok(!shell.slice(shell.indexOf('<aside'), shell.indexOf('</aside>')).includes('justify-between'));
  });
  it('the active item has the same size and padding as the others, with only the colour and gold bar added', () => {
    assert.ok(!shell.includes("active ? 'pl-1.5'"));
    assert.ok(shell.includes("? 'bg-[#783535] text-white shadow-sm font-semibold'"));
    assert.ok(shell.includes('absolute left-1 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-[#E5B53A]'));
  });
  it('shows no notification bell or count, because the app has no notification data to show', () => {
    assert.ok(!/bell|notification|unread/i.test(shell));
  });
  it('a tablet starts collapsed when there is no saved choice; a saved choice still wins', () => {
    assert.ok(shell.includes("window.matchMedia('(max-width: 1023px)').matches"));
    assert.ok(shell.includes("window.sessionStorage.getItem('ccms_sidebar_collapsed')"));
  });
});
