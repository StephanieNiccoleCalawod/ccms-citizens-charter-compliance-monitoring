// Notification bell (CC055), through the gateway. Two feeds, joined on the screen; one failing does not hide the other.
//   GET  /api/logs/notifications          complaint and calendar notices + this user's read keys   (Oversight)
//   GET  /api/operations/notifications    overdue, near-deadline and high-risk notices            (Operations)
//   POST /api/logs/notifications/read     { keys: [...] }
import { apiFetch } from '../auth/session.js';

export const OVERSIGHT_NOTIFICATIONS_API = '/api/logs/notifications';
export const OPERATIONS_NOTIFICATIONS_API = '/api/operations/notifications';

export async function getNotificationFeeds(fetcher = apiFetch) {
  const [oversight, operations] = await Promise.allSettled([fetcher(OVERSIGHT_NOTIFICATIONS_API), fetcher(OPERATIONS_NOTIFICATIONS_API)]);
  return { oversight, operations };
}
export const markNotificationsRead = (keys, fetcher = apiFetch) => fetcher(`${OVERSIGHT_NOTIFICATIONS_API}/read`, { method: 'POST', body: { keys } });
