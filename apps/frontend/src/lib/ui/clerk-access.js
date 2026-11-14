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
 * One list for the Clerk Sign-in Access table: people waiting for approval (newest sign-in first), then approved accounts
 * (newest approval first), each keeping the order the API gave. Each row says which kind it is, so the table shows the right
 * status and actions. Keys are prefixed by kind and repeated keys are dropped, so a record is never listed twice.
 */
export function clerkAccessRows(requests = [], links = [], accountsById = new Map()) {
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
  for (const link of links ?? []) {
    const key = `approved:${link.account_id}`;
    if (rows.has(key)) continue;
    const account = accountsById.get(link.account_id);
    rows.set(key, {
      key,
      status: 'approved',
      link,
      primary: account?.full_name ?? 'Inactive account',
      secondary: account?.employee_no ?? null,
      date: link.linked_at,
      dateLabel: 'Approved',
      search: [account?.full_name, account?.employee_no, account?.email].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  return [...rows.values()];
}

/** The table's search and status filter. status: '' (all) | 'pending' | 'approved'. Search ignores case and outer spaces. */
export function filterClerkAccessRows(rows, { q = '', status = '' } = {}) {
  const needle = String(q ?? '').trim().toLowerCase();
  return (rows ?? []).filter((row) => (!status || row.status === status) && (!needle || row.search.includes(needle)));
}

/** The empty message for the table, by filter. A search with no match says so instead. */
export function clerkAccessEmptyMessage({ q = '', status = '' } = {}) {
  if (String(q ?? '').trim()) return 'No Clerk accounts match your search.';
  if (status === 'pending') return 'No users waiting for approval.';
  if (status === 'approved') return 'No approved Clerk accounts yet.';
  return 'No Clerk accounts found.';
}

/** "Juan Dela Cruz (EMP-1001)" for the account choice; never the email, which is shown separately as the hint. */
export function accountLabel(account) {
  if (!account) return '';
  return account.employee_no ? `${account.full_name} (${account.employee_no})` : account.full_name;
}
