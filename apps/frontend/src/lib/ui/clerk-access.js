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

/** "Juan Dela Cruz (EMP-1001)" for the account choice; never the email, which is shown separately as the hint. */
export function accountLabel(account) {
  if (!account) return '';
  return account.employee_no ? `${account.full_name} (${account.employee_no})` : account.full_name;
}
