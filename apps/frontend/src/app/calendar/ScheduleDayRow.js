'use client';

import { DAY_NAMES } from '../../lib/api/calendar.js';
import { FieldError } from '../../components/forms/Field.js';
import { errorKey, time12, toggleLunch, toggleWorking } from '../../lib/ui/office-schedule.js';

/** A native time input (the value is 24-hour HH:MM, as the API wants it) with the same time in 12-hour words under it. */
export function TimeField({ id, label, value, onChange, disabled, error, hideLabel = false }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={`mb-1 block text-xs font-semibold text-slate-600 ${hideLabel ? 'md:sr-only' : ''}`}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className="input bg-transparent"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <p className="mt-0.5 text-xs text-slate-500" data-testid={`${id}-12h`}>{time12(value) || ' '}</p>
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

function Switch({ checked, onChange, disabled, label, small = false }) {
  const track = small ? 'h-5 w-9' : 'h-6 w-11';
  const knob = small ? 'h-4 w-4' : 'h-5 w-5';
  const travel = small ? 'translate-x-4' : 'translate-x-5';
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="flex items-center gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
      <span aria-hidden="true" className={`relative shrink-0 rounded-full transition-colors ${track} ${checked ? 'bg-green-700' : 'bg-slate-300'}`}>
        <span className={`absolute left-0.5 top-0.5 rounded-full bg-white shadow transition-transform ${knob} ${checked ? travel : ''}`} />
      </span>
    </button>
  );
}

/**
 * One day of the week with its own hours: working switch, opening and closing time and, for an office, the lunch break. Used when the
 * hours are set day by day ("Set different hours for specific days"). `showLunch` is false for the campus, which has no lunch break.
 */
export default function ScheduleDayRow({ row, errors, disabled, showLunch, onChange }) {
  const dow = row.day_of_week;
  const name = DAY_NAMES[dow];
  const id = `d${dow}`;
  const patch = (change) => onChange({ ...row, ...change });
  const columns = showLunch ? 'md:grid-cols-[9rem_1fr_1fr_8rem_1fr_1fr]' : 'md:grid-cols-[9rem_1fr_1fr]';
  return (
    <li className={`grid items-start gap-3 py-4 ${columns}`} data-testid={`day-${dow}`}>
      <div className="flex items-center gap-3 pt-1 text-sm font-semibold text-slate-900">
        <Switch checked={row.is_working} disabled={disabled} label={`${name}: working day`} onChange={() => onChange(toggleWorking(row))} />
        <span>
          {name}
          <span className="block text-xs font-normal text-slate-500">{row.is_working ? 'Working day' : 'Closed'}</span>
        </span>
      </div>
      {row.is_working ? (
        <>
          <TimeField id={`${id}-open`} label={`${name} opens`} hideLabel value={row.opening_time} disabled={disabled} onChange={(v) => patch({ opening_time: v })} error={errors[errorKey(dow, 'opening_time')]} />
          <TimeField id={`${id}-close`} label={`${name} closes`} hideLabel value={row.closing_time} disabled={disabled} onChange={(v) => patch({ closing_time: v })} error={errors[errorKey(dow, 'closing_time')]} />
          {showLunch ? (
            <>
              <div className="flex items-center gap-2 pt-1 text-sm text-slate-800">
                <Switch small checked={row.closes_for_lunch} disabled={disabled} label={`${name}: closes for lunch`} onChange={() => onChange(toggleLunch(row))} />
                Lunch break
              </div>
              <TimeField id={`${id}-lunch-start`} label={`${name} lunch starts`} hideLabel value={row.lunch_start} disabled={disabled || !row.closes_for_lunch} onChange={(v) => patch({ lunch_start: v })} error={errors[errorKey(dow, 'lunch_start')]} />
              <TimeField id={`${id}-lunch-end`} label={`${name} lunch ends`} hideLabel value={row.lunch_end} disabled={disabled || !row.closes_for_lunch} onChange={(v) => patch({ lunch_end: v })} error={errors[errorKey(dow, 'lunch_end')]} />
            </>
          ) : null}
        </>
      ) : (
        <p className={`pt-2 text-sm text-slate-500 ${showLunch ? 'md:col-span-5' : 'md:col-span-2'}`}>Closed all day.</p>
      )}
    </li>
  );
}
