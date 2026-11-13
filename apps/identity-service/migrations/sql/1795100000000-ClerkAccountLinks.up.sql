-- Clerk sign-in (Landas 1, Shared Clerk Access Playbook R3): a CCMS account is bound to one Clerk user by issuer and
-- user ID (sub), never by email. Only a Super Admin creates the binding, after the person has signed in once.
-- The accounts table is not changed. Keep identical to the ClerkAccountLink / ClerkAccessRequest entities.
CREATE TABLE IF NOT EXISTS account_clerk_links (
    account_id uuid NOT NULL,
    clerk_issuer text NOT NULL,
    clerk_user_id text NOT NULL,
    linked_by uuid NOT NULL,
    linked_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT account_clerk_links_pkey PRIMARY KEY (account_id),
    CONSTRAINT account_clerk_links_subject_uq UNIQUE (clerk_issuer, clerk_user_id)
);

-- A person who signed in with Clerk but is not bound to a CCMS account yet ("No access yet"). One row per Clerk user;
-- the email is the session-token claim, shown to the Super Admin as a hint only. Removed when bound or dismissed.
CREATE TABLE IF NOT EXISTS clerk_access_requests (
    clerk_issuer text NOT NULL,
    clerk_user_id text NOT NULL,
    email text,
    first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT clerk_access_requests_pkey PRIMARY KEY (clerk_issuer, clerk_user_id)
);
