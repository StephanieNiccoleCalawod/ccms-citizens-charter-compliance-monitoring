-- Office-scoped staff permission switches: adds scope ('ALL' | 'SPECIFIC') to permission_switches and
-- permission_switch_offices for the specific office UUIDs. Keep identical to PermissionSwitch / PermissionSwitchOffice
-- and src/lib/after-sync.js.
ALTER TABLE permission_switches
    ADD COLUMN IF NOT EXISTS scope character varying(10) NOT NULL DEFAULT 'ALL';

CREATE TABLE IF NOT EXISTS permission_switch_offices (
    switch_key character varying(40) NOT NULL,
    office_id uuid NOT NULL,
    CONSTRAINT permission_switch_offices_pkey PRIMARY KEY (switch_key, office_id),
    CONSTRAINT permission_switch_offices_switch_fk FOREIGN KEY (switch_key) REFERENCES permission_switches(switch_key)
);
