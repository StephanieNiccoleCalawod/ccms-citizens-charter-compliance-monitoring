// Dedicated QA receivers. No request is forwarded to a real integration or mail provider.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { appEnv } from './common.mjs';

const authorized = (header, token) => {
  const actual = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${token ?? ''}`);
  return Boolean(token) && actual.length === expected.length && timingSafeEqual(actual, expected);
};
const reply = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
async function bodyOf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON');
  return value;
}

try {
  const env = await appEnv('core-service');
  const origin = new URL(env.QA_MOCK_ORIGIN);
  const bindHost = env.QA_ENV_TYPE === 'local' ? '127.0.0.1' : process.env.QA_MOCK_BIND_HOST;
  const port = env.QA_ENV_TYPE === 'local' ? Number(origin.port) : Number(process.env.PORT);
  if (!bindHost || !port) throw new Error('Hosted mocks require a dedicated bind host and port behind their QA HTTPS origin');
  if (!env.QA_MOCK_CONTROL_TOKEN || !env.FMS_CALENDAR_TOKEN || !env.SMS_SERVICE_TOKEN) throw new Error('QA mock credentials are required');
  const systems = { FMS: { status: 200, attempts: 0, accepted: 0 }, SCMS: { status: 200, attempts: 0, accepted: 0 } };
  const seen = { FMS: new Set(), SCMS: new Set() };
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://qa.invalid').pathname;
      if (path === '/control') {
        if (!authorized(req.headers.authorization, env.QA_MOCK_CONTROL_TOKEN)) return reply(res, 401, { error: 'UNAUTHORIZED' });
        if (req.method === 'GET') return reply(res, 200, { environment: 'qa', targetSet: env.QA_TARGET_SET_ID, systems });
        if (req.method !== 'POST') return reply(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        const body = await bodyOf(req);
        if (!Object.hasOwn(systems, body.system) || ![200, 401, 429, 503].includes(body.status)) return reply(res, 400, { error: 'INVALID_MOCK_MODE' });
        systems[body.system].status = body.status;
        return reply(res, 200, { system: body.system, status: body.status });
      }
      const system = path === '/fms/calendar' ? 'FMS' : path.startsWith('/scms/') ? 'SCMS' : null;
      if (!system) return reply(res, 404, { error: 'NOT_FOUND' });
      if (req.method !== 'POST') return reply(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const state = systems[system];
      state.attempts += 1;
      const token = system === 'FMS' ? env.FMS_CALENDAR_TOKEN : env.SMS_SERVICE_TOKEN;
      if (!authorized(req.headers.authorization, token) || state.status === 401) return reply(res, 401, { reason: 'QA_KEY_REJECTED' });
      const body = await bodyOf(req);
      if (state.status !== 200) return reply(res, state.status, { reason: 'QA_CONFIGURED_FAILURE' });
      const id = body.messageId ?? body.sync_id ?? body.syncId;
      const duplicate = typeof id === 'string' && seen[system].has(id);
      if (!duplicate) {
        state.accepted += 1;
        if (typeof id === 'string') {
          if (seen[system].size >= 10_000) seen[system].delete(seen[system].values().next().value);
          seen[system].add(id);
        }
      }
      return reply(res, 200, { result: 'ACCEPTED', status: 'SUCCESS', term_code: body.term_code ?? null, duplicate });
    } catch (error) {
      reply(res, error.message === 'BODY_TOO_LARGE' ? 413 : 400, { error: 'INVALID_REQUEST' });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('error', () => { console.error('QA mock receiver could not listen.'); process.exitCode = 1; });
  server.listen(port, bindHost, () => console.log('Dedicated QA FMS/SCMS receivers started; no outbound integrations are enabled.'));
  const stop = () => server.close(() => { process.exitCode = 0; });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) { console.error(error.message); process.exitCode = 1; }
