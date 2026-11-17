// Screen text and small rules for Clerk sign-in access (Landas 1). Pure functions, tested on their own.

const COPY = Object.freeze({
  CCMS_ACCESS_PENDING: {
    title: 'No access yet',
    body: 'You are signed in, but a CCMS administrator has not approved your account yet. Ask your CCMS Super Admin to approve you, then choose "Check again".',
    canRetry: true,
  },
  ACCOUNT_INACTIVE: {
    title: 'Your CCMS access is turned off',
    body: 'Your CCMS account is deactivated. Ask your CCMS Super Admin if you need access again.',
    canRetry: true,
  },
  IMPERSONATION_NOT_ALLOWED: {
    title: 'Not allowed',
    body: 'Signing in as another person is not allowed in CCMS. Sign out and sign in with your own account.',
    canRetry: false,
  },
});

/**
 * What the Clerk sign-in page should show for the browser's Clerk session:
 *   'signed-out'  no session: show Clerk's sign-in form
 *   'active'      signed in: trade the session for CCMS access
 *   'pending'     signed in but Clerk still needs a step (a session task): never show the sign-in form, because Clerk sends a
 *                 signed-in visitor of the form back to the redirect URL, which is this page again (an endless reload)
 */
export function clerkSessionState(session) {
  if (!session) return 'signed-out';
  return session.status === 'active' ? 'active' : 'pending';
}

/** The pending session task as a readable phrase (Clerk task keys such as "reset-password"); a generic phrase otherwise. */
export function pendingTaskLabel(session) {
  const key = session?.currentTask?.key;
  const labels = { 'reset-password': 'set a new password', 'setup-mfa': 'set up two-step verification', 'choose-organization': 'choose an organization' };
  return labels[key] ?? 'finish one more step';
}

/** The message for the "No access yet" page. Unknown or missing reasons get the pending message, never text from the URL. */
export function accessPendingCopy(reason) {
  return COPY[reason] ?? COPY.CCMS_ACCESS_PENDING;
}

/**
 * Accounts the Super Admin may bind to a pending sign-in: active and not linked yet, sorted by name. The suggested account
 * (exact email match from Identity) comes first. It is only a suggestion: the Super Admin still chooses.
 */
export function bindableAccounts(accounts, linkedIds, suggestedId = null) {
  const linked = new Set(linkedIds ?? []);
  const list = (accounts ?? []).filter((a) => a.is_active !== false && !linked.has(a.account_id));
  list.sort((a, b) => (a.account_id === suggestedId ? -1 : b.account_id === suggestedId ? 1 : String(a.full_name).localeCompare(String(b.full_name))));
  return list;
}

/**
 * The access states the Clerk Sign-in Access table shows. None is stored: each is worked out from data that already exists.
 *   pending      signed in with Clerk, not bound to a CCMS account yet (the Super Admin approves or dismisses)
 *   active       bound, and the CCMS account is active: can sign in
 *   deactivated  bound, but the CCMS account is deactivated: cannot sign in (CCMS-only revocation, playbook R4)
 *   not_linked   an active CCMS account with no Clerk login bound yet (the "Invited" of the access review)
 */
export const CLERK_ACCESS_STATUSES = Object.freeze([
  { value: 'pending', label: 'Pending', tone: 'warning' },
  { value: 'active', label: 'Active', tone: 'success' },
  { value: 'deactivated', label: 'Deactivated', tone: 'neutral' },
  { value: 'not_linked', label: 'Not linked', tone: 'info' },
]);
const STATUS_BY_VALUE = Object.fromEntries(CLERK_ACCESS_STATUSES.map((s) => [s.value, s]));
export const clerkAccessStatus = (value) => STATUS_BY_VALUE[value] ?? { value, label: value, tone: 'neutral' };

/**
 * One list for the Clerk Sign-in Access table, in this order: pending (newest sign-in first), active and deactivated
 * (newest approval first), then active CCMS accounts that are not linked yet (by name). Names come from the links answer
 * (which includes deactivated accounts) and fall back to the active-accounts list. Keys are prefixed by kind and repeated
 * keys are dropped, so a record is never listed twice; a linked account is never also listed as not linked.
 */
export function clerkAccessRows(requests = [], links = [], accounts = [], invited = []) {
  const byId = new Map((accounts ?? []).map((a) => [a.account_id, a]));
  const invitedByAccount = new Map((invited ?? []).map((i) => [i.account_id, i]));
  const rows = new Map();
  for (const request of requests ?? []) {
    const key = `pending:${request.clerk_user_id}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      key,
      status: 'pending',
      request,
      primary: request.email ?? 'No email shared',
      secondary: request.clerk_user_id,
      date: request.last_seen_at,
      dateLabel: 'Last sign-in',
      search: [request.email, request.clerk_user_id].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  const linkedIds = new Set();
  const linkRows = [];
  for (const link of links ?? []) {
    const key = `linked:${link.account_id}`;
    if (linkedIds.has(link.account_id)) continue;
    linkedIds.add(link.account_id);
    const account = byId.get(link.account_id);
    const name = link.full_name ?? account?.full_name ?? null;
    const employeeNo = link.employee_no ?? account?.employee_no ?? null;
    const isActive = link.is_active ?? (account ? account.is_active !== false : false);
    linkRows.push({
      key,
      status: isActive ? 'active' : 'deactivated',
      link,
      accountId: link.account_id,
      primary: name ?? 'Unknown account',
      secondary: employeeNo,
      date: link.linked_at,
      dateLabel: 'Approved',
      search: [name, employeeNo, account?.email].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  for (const row of linkRows) rows.set(row.key, row);
  const notLinked = (accounts ?? [])
    .filter((a) => a.is_active !== false && !linkedIds.has(a.account_id))
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  for (const account of notLinked) {
    const key = `not_linked:${account.account_id}`;
    if (rows.has(key)) continue;
    const openInvitation = invitedByAccount.get(account.account_id) ?? null;
    rows.set(key, {
      key,
      status: 'not_linked',
      account,
      accountId: account.account_id,
      invited: openInvitation,
      primary: account.full_name,
      secondary: [account.employee_no, account.email].filter(Boolean).join(' · ') || null,
      date: openInvitation?.invited_at ?? null,
      dateLabel: openInvitation ? 'Invited' : 'Not signed in with Clerk yet',
      search: [account.full_name, account.employee_no, account.email].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  return [...rows.values()];
}

/** The table's search and status filter. status: '' (all) or one of CLERK_ACCESS_STATUSES. Search ignores case and outer spaces. */
export function filterClerkAccessRows(rows, { q = '', status = '' } = {}) {
  const needle = String(q ?? '').trim().toLowerCase();
  return (rows ?? []).filter((row) => (!status || row.status === status) && (!needle || row.search.includes(needle)));
}

/** The empty message for the table, by filter. A search with no match says so instead. */
export function clerkAccessEmptyMessage({ q = '', status = '' } = {}) {
  if (String(q ?? '').trim()) return 'No Clerk accounts match your search.';
  if (status === 'pending') return 'No users waiting for approval.';
  if (status === 'active') return 'No account can sign in with Clerk yet.';
  if (status === 'deactivated') return 'No deactivated account is linked to Clerk.';
  if (status === 'not_linked') return 'Every active account is linked to Clerk.';
  return 'No Clerk accounts found.';
}

/** What Flow B found for an account, as one sentence for the screen. */
export function directoryResultText(result, { invitations = false } = {}) {
  if (!result) return '';
  const open = (result.matches ?? []).filter((m) => !m.already_linked);
  if (open.length === 0 && (result.matches ?? []).length > 0) return 'This Clerk login is already linked to another CCMS account.';
  if (open.length === 0) {
    return invitations
      ? 'No Clerk login uses this email yet. Send an invitation to create one.'
      : 'No Clerk login uses this email yet. Ask the instance owner to invite this person.';
  }
  return open.length === 1 ? 'One Clerk login uses this email. Check it is the right person, then link it.' : 'More than one Clerk login uses this email. Link only the right person.';
}

/**
 * The initial password on Add Account, by sign-in mode (Identity accepts an empty password only while Clerk is on):
 *   legacy          required (as before)
 *   dual or clerk   optional: empty means the person signs in with their PUP account and sets their own password in Clerk.
 *                   The field stays visible (labelled optional) for someone who will still use the email and password sign-in.
 */
export function accountPasswordMode({ provider = 'legacy', clerkOn = false } = {}) {
  return { passwordOptional: clerkOn && provider !== 'legacy' };
}

/** "Juan Dela Cruz (EMP-1001)" for the account choice; never the email, which is shown separately as the hint. */
export function accountLabel(account) {
  if (!account) return '';
  return account.employee_no ? `${account.full_name} (${account.employee_no})` : account.full_name;
}
