-- Frozen from the reviewed explicit migration at e70fd8d; append new migrations for later changes.
CREATE TABLE IF NOT EXISTS office_schedules (
    office_id uuid NOT NULL,
    weekday smallint NOT NULL,
    is_working boolean NOT NULL DEFAULT false,
    opens_at text,
    closes_at text,
    closes_for_lunch boolean NOT NULL DEFAULT false,
    lunch_start text,
    lunch_end text,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (office_id, weekday));

CREATE TABLE IF NOT EXISTS office_schedule_versions (
    office_id uuid PRIMARY KEY,
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now());

ALTER TABLE office_schedules ADD CONSTRAINT office_schedules_office_fk FOREIGN KEY (office_id) REFERENCES offices (office_id);

ALTER TABLE office_schedule_versions ADD CONSTRAINT office_schedule_versions_office_fk FOREIGN KEY (office_id) REFERENCES offices (office_id);

ALTER TABLE office_schedules ADD CONSTRAINT office_schedules_weekday_ck CHECK (weekday BETWEEN 0 AND 6);

ALTER TABLE office_schedules ADD CONSTRAINT office_schedules_version_ck CHECK (version >= 1);

ALTER TABLE office_schedule_versions ADD CONSTRAINT office_schedule_versions_version_ck CHECK (version >= 0);

ALTER TABLE office_schedules ADD CONSTRAINT office_schedules_times_ck CHECK (
      (is_working = false AND opens_at IS NULL AND closes_at IS NULL)
      OR (is_working = true AND opens_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND closes_at ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND closes_at > opens_at)
    );

ALTER TABLE office_schedules ADD CONSTRAINT office_schedules_lunch_ck CHECK (
      (closes_for_lunch = false AND lunch_start IS NULL AND lunch_end IS NULL)
      OR (closes_for_lunch = true AND is_working = true AND lunch_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND lunch_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          AND lunch_start >= opens_at AND lunch_end <= closes_at AND lunch_end > lunch_start)
    );
