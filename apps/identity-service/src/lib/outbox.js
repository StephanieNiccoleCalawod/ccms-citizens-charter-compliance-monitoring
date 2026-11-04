import { after } from 'next/server.js';

// There is no background process on Vercel, so "send it right away" means: after the response has
// been sent, run one dispatch. If that does not happen (the function is stopped, Logs is down) the
// cron job in src/jobs picks the work up on its next run. Outside a request (tests, scripts)
// after() is not available and the cron route is the only sender - which is fine.
export function kickOutbox() {
  try {
    after(async () => {
      try {
        await (await import('../jobs/outbox-dispatch.js')).runOutboxDispatch();
      } catch (err) {
        console.error('Outbox dispatch after response failed:', err.message);
      }
    });
  } catch {
    /* not inside a request */
  }
}
