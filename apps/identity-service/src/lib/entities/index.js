import { OutboxEvent, RateLimitHit } from 'ccms-shared';
import { EntitySchema } from 'typeorm';

// CCMS accounts. Independent of FMS and Audit (no SSO). Accounts are deactivated, never deleted,
// because transactions and logs reference them. office_id is a plain ID owned by the Catalogue
// service (no foreign key across services); Identity validates it over HTTP.
export const Account = new EntitySchema({
  name: 'Account',
  tableName: 'accounts',
  columns: {
    accountId: { name: 'account_id', type: 'uuid', primary: true },
    employeeNo: { name: 'employee_no', type: 'text' },
    fullName: { name: 'full_name', type: 'text' },
    email: { type: 'text' },
    passwordHash: { name: 'password_hash', type: 'text' },
    roleKey: { name: 'role_key', type: 'text' },
    officeId: { name: 'office_id', type: 'uuid', nullable: true },
    // CC046: a label only (no salary grade, no permission effect).
    position: { type: 'varchar', length: 100, nullable: true },
    isActive: { name: 'is_active', type: 'boolean', default: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', updateDate: true },
  },
  uniques: [{ name: 'accounts_employee_no_uq', columns: ['employeeNo'] }],
  indices: [{ name: 'accounts_role_idx', columns: ['roleKey'] }, { name: 'accounts_office_idx', columns: ['officeId'] }],
  checks: [
    {
      name: 'accounts_role_valid',
      expression: `"role_key" IN ('super_admin', 'office_head', 'office_staff', 'executive')`,
    },
    {
      // Office Head / Office Staff need an office; Executive / Super Admin never have one.
      name: 'accounts_office_rule',
      expression: `("role_key" IN ('office_head', 'office_staff') AND "office_id" IS NOT NULL) OR ("role_key" IN ('super_admin', 'executive') AND "office_id" IS NULL)`,
    },
  ],
});

// CC056: the four staff permission switches (default off). One row per switch; updated_by is the Super Admin who last changed it.
// The CHECK on the key and the seed rows are created in after-sync / migrations/1794650000000-Cc056PermissionSwitches.js.
export const PermissionSwitch = new EntitySchema({
  name: 'PermissionSwitch',
  tableName: 'permission_switches',
  columns: {
    switchKey: { name: 'switch_key', type: 'varchar', length: 40, primary: true, primaryKeyConstraintName: 'permission_switches_pkey' },
    enabled: { type: 'boolean', default: false },
    updatedBy: { name: 'updated_by', type: 'uuid', nullable: true },
    updatedAt: { name: 'updated_at', type: 'timestamptz', default: () => 'now()' },
  },
});

// CC056: when the person last signed in (shown on My account). Not part of accounts so the accounts table is untouched.
export const AccountLastLogin = new EntitySchema({
  name: 'AccountLastLogin',
  tableName: 'account_last_login',
  columns: {
    accountId: { name: 'account_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'account_last_login_pkey' },
    lastLoginAt: { name: 'last_login_at', type: 'timestamptz' },
  },
});

// Refresh tokens are stored hashed so they can be revoked without keeping the secret.
export const RefreshToken = new EntitySchema({
  name: 'RefreshToken',
  tableName: 'refresh_tokens',
  columns: {
    tokenHash: { name: 'token_hash', type: 'text', primary: true },
    accountId: { name: 'account_id', type: 'uuid' },
    expiresAt: { name: 'expires_at', type: 'timestamptz' },
    revokedAt: { name: 'revoked_at', type: 'timestamptz', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  indices: [{ name: 'refresh_tokens_account_idx', columns: ['accountId'] }],
});

export const PasswordResetToken = new EntitySchema({
  name: 'PasswordResetToken',
  tableName: 'password_reset_tokens',
  columns: {
    tokenHash: { name: 'token_hash', type: 'text', primary: true },
    accountId: { name: 'account_id', type: 'uuid' },
    expiresAt: { name: 'expires_at', type: 'timestamptz' },
    usedAt: { name: 'used_at', type: 'timestamptz', nullable: true },
    createdAt: { name: 'created_at', type: 'timestamptz', createDate: true },
  },
  indices: [{ name: 'password_reset_tokens_account_idx', columns: ['accountId'] }],
});

// Clerk sign-in (Landas 1): a CCMS account is bound to exactly one Clerk user by issuer and user ID (sub), never by
// email (Shared Clerk Access Playbook R3). Only a Super Admin creates the binding. Keep identical to
// migrations/sql/1795100000000-ClerkAccountLinks.up.sql. accounts itself is untouched.
export const ClerkAccountLink = new EntitySchema({
  name: 'ClerkAccountLink',
  tableName: 'account_clerk_links',
  columns: {
    accountId: { name: 'account_id', type: 'uuid', primary: true, primaryKeyConstraintName: 'account_clerk_links_pkey' },
    clerkIssuer: { name: 'clerk_issuer', type: 'text' },
    clerkUserId: { name: 'clerk_user_id', type: 'text' },
    linkedBy: { name: 'linked_by', type: 'uuid' },
    linkedAt: { name: 'linked_at', type: 'timestamptz', default: () => 'now()' },
  },
  uniques: [{ name: 'account_clerk_links_subject_uq', columns: ['clerkIssuer', 'clerkUserId'] }],
});

// Signed in with Clerk but not bound to a CCMS account yet ("No access yet"). The email is the token claim, a hint for the
// Super Admin only; it never grants access. Removed when the person is bound or the request is dismissed.
export const ClerkAccessRequest = new EntitySchema({
  name: 'ClerkAccessRequest',
  tableName: 'clerk_access_requests',
  columns: {
    clerkIssuer: { name: 'clerk_issuer', type: 'text', primary: true, primaryKeyConstraintName: 'clerk_access_requests_pkey' },
    clerkUserId: { name: 'clerk_user_id', type: 'text', primary: true, primaryKeyConstraintName: 'clerk_access_requests_pkey' },
    email: { type: 'text', nullable: true },
    firstSeenAt: { name: 'first_seen_at', type: 'timestamptz', default: () => 'now()' },
    lastSeenAt: { name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' },
  },
});

export const entities = [Account, RefreshToken, PasswordResetToken, OutboxEvent, RateLimitHit, PermissionSwitch, AccountLastLogin, ClerkAccountLink, ClerkAccessRequest];
