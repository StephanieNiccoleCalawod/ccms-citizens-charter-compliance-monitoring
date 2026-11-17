-- Clerk sign-in, Flow A (Shared Clerk Access Playbook): invitations sent by CCCMS. A Super Admin invites the person behind
-- an existing CCMS account; the Clerk invitation carries only an opaque reference under public_metadata.cccms (R2). On the
-- person's first sign-in, Identity reads that reference from the Clerk user (Backend API) and binds the account by issuer +
-- Clerk user ID (R3). Only the SHA-256 of the reference is stored. A reference is usable once (used_at) and can be revoked
-- (revoked_at; only invitations CCCMS created, R5). Keep identical to the ClerkInvitation entity.
CREATE TABLE IF NOT EXISTS clerk_invitations (
    clerk_invitation_id text NOT NULL,
    account_id uuid NOT NULL,
    clerk_issuer text NOT NULL,
    ref_hash text NOT NULL,
    email text NOT NULL,
    invited_by uuid NOT NULL,
    invited_at timestamp with time zone NOT NULL DEFAULT now(),
    used_at timestamp with time zone,
    used_by_clerk_user_id text,
    revoked_at timestamp with time zone,
    CONSTRAINT clerk_invitations_pkey PRIMARY KEY (clerk_invitation_id),
    CONSTRAINT clerk_invitations_ref_uq UNIQUE (ref_hash)
);

-- At most one open (not used, not revoked) invitation per account.
CREATE UNIQUE INDEX IF NOT EXISTS clerk_invitations_open_uq ON clerk_invitations (account_id) WHERE used_at IS NULL AND revoked_at IS NULL;
