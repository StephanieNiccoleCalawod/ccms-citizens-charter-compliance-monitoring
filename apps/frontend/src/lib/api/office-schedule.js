// CC048: an office's own working days and hours, as the browser calls it, through the gateway:
// /api/calendar/offices/:id/schedule arrives at the Core service as /api/offices/:id/schedule.
//   GET    -> { office_id, uses_campus_schedule, version, items: [7 days, Sunday first] }   (items = the schedule that applies)
//   PUT    { version, days: [7 items] } -> the saved schedule. 400 names each invalid field; 409 means the version is stale.
//   DELETE ?version=N -> the office goes back to the campus schedule. 409 means the version is stale.
// An item is { day_of_week (0 = Sunday), is_working, opening_time, closing_time, closes_for_lunch, lunch_start, lunch_end }, times 'HH:MM'.
import { apiFetch } from '../auth/session.js';

export const CAMPUS_SCHEDULE_API = '/api/calendar/schedule';
export const CAMPUS_HISTORY_API = '/api/calendar/schedule/history';
export const officeScheduleUrl = (officeId) => `/api/calendar/offices/${encodeURIComponent(officeId)}/schedule`;

export const getCampusSchedule = (fetcher = apiFetch) => fetcher(CAMPUS_SCHEDULE_API);
export const getOfficeSchedule = (officeId, fetcher = apiFetch) => fetcher(officeScheduleUrl(officeId));
export const saveOfficeSchedule = (officeId, { version, days }, fetcher = apiFetch) => fetcher(officeScheduleUrl(officeId), { method: 'PUT', body: { version, days } });
export const resetOfficeSchedule = (officeId, version, fetcher = apiFetch) => fetcher(`${officeScheduleUrl(officeId)}?version=${encodeURIComponent(version)}`, { method: 'DELETE' });

// The campus schedule (CC014): PUT { days } and, for a Super Admin, the list of saved versions (newest first).
export const saveCampusSchedule = (days, fetcher = apiFetch) => fetcher(CAMPUS_SCHEDULE_API, { method: 'PUT', body: { days } });
export const getCampusHistory = (fetcher = apiFetch) => fetcher(CAMPUS_HISTORY_API);
