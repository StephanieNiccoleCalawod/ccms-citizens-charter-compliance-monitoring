-- Sprint 6 CC056: the four staff permission switches (all off) and the last sign-in time shown on My account.
-- Keep identical to switchRules() in src/lib/after-sync.js and to the PermissionSwitch / AccountLastLogin entities.
CREATE TABLE IF NOT EXISTS permission_switches (
    switch_key character varying(40) NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    updated_by uuid,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT permission_switches_pkey PRIMARY KEY (switch_key),
    CONSTRAINT permission_switches_key_ck CHECK (switch_key IN ('STAFF_HOLD_RESUME', 'STAFF_BACKDATE', 'STAFF_VIEW_COMPLAINTS', 'STAFF_VIEW_REPORTS'))
);

CREATE TABLE IF NOT EXISTS account_last_login (
    account_id uuid NOT NULL,
    last_login_at timestamp with time zone NOT NULL,
    CONSTRAINT account_last_login_pkey PRIMARY KEY (account_id)
);

INSERT INTO permission_switches (switch_key, enabled) VALUES
    ('STAFF_HOLD_RESUME', false), ('STAFF_BACKDATE', false), ('STAFF_VIEW_COMPLAINTS', false), ('STAFF_VIEW_REPORTS', false)
ON CONFLICT (switch_key) DO NOTHING;
