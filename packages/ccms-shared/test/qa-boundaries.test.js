import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { assertQaDatabaseTarget, assertQaServiceTargets, qaDatabaseIdentity } from '../src/qa.js';

const config = JSON.parse(readFileSync(new URL('../../../qa/targets.example.json', import.meta.url), 'utf8'));
const databaseUrl = 'postgres://qa:qa@127.0.0.1:16435/ccms_core_qa';
const environment = () => ({
  CCMS_ENVIRONMENT: 'qa', QA_TARGET_SET_ID: config.id, QA_ENV_TYPE: 'local', QA_SERVICE_KIND: 'core-service',
  QA_SERVICES_JSON: JSON.stringify(config.services), QA_MOCK_ORIGIN: config.mocks.origin,
  QA_MAIL_MODE: 'capture', QA_MAILBOX_ORIGIN: config.mail.captureUrl,
  QA_SMTP_HOST: config.mail.smtpHost, QA_SMTP_PORT: String(config.mail.smtpPort),
  SMTP_HOST: config.mail.smtpHost, SMTP_PORT: String(config.mail.smtpPort),
  QA_DATABASE_IDENTITIES_JSON: JSON.stringify(Object.values(config.databases).map((d) => d.identity)),
  QA_DATABASE_IDENTITY: config.databases['core-service'].identity,
  QA_PROTECTED_DATABASE_IDENTITIES_JSON: JSON.stringify(config.protected.databaseIdentities),
  QA_PROTECTED_SERVICE_ORIGINS_JSON: JSON.stringify(config.protected.serviceOrigins),
  QA_OVERSIGHT_CLUSTER_ISOLATED: 'true', DB_SYNCHRONIZE: 'false', DB_TARGET: 'local',
  JWT_ISSUER: 'ccms-identity-qa-local', VERIFY_TOKENS: 'true', HOLIDAY_AUTO_IMPORT: 'false',
  CORE_URL: config.services['core-service'], API_GATEWAY_URL: config.services['api-gateway'],
  CORE_SERVICE_URL: `${config.services['core-service']}/api`, CCMS_CALENDAR_URL: config.services['core-service'],
  IDENTITY_URL: config.services['identity-service'], IDENTITY_SERVICE_URL: `${config.services['identity-service']}/api`,
  IDENTITY_JWKS_URL: `${config.services['identity-service']}/api/auth/jwks`, PUBLIC_BASE_URL: config.services.frontend,
  LOGS_URL: config.services['oversight-service'], LOGS_SERVICE_URL: `${config.services['oversight-service']}/api`,
  OPERATIONS_URL: config.services['operations-service'], OPERATIONS_SERVICE_URL: `${config.services['operations-service']}/api`,
  FMS_URL: `${config.mocks.origin}/fms/calendar`, SMS_URL: `${config.mocks.origin}/scms`,
});

describe('TT5 QA isolation boundaries (no network or database access)', () => {
  it('leaves existing non-QA environments unchanged', () => {
    assert.doesNotThrow(() => assertQaServiceTargets({}));
    assert.doesNotThrow(() => assertQaDatabaseTarget(undefined, { env: { CCMS_ENVIRONMENT: 'production' }, synchronize: false }));
  });
  it('accepts the separate local QA target set', () => {
    assert.doesNotThrow(() => assertQaDatabaseTarget(databaseUrl, { env: environment() }));
  });
  it('refuses a demo database and the database assigned to another service', () => {
    const env = environment();
    assert.throws(() => assertQaDatabaseTarget('postgres://qa:qa@127.0.0.1:5435/ccms_core', { env }), /assigned QA database/);
    assert.throws(() => assertQaDatabaseTarget('postgres://qa:qa@127.0.0.1:16433/ccms_identity_qa', { env }), /assigned QA database/);
  });
  it('refuses overlapping database sets and synchronization', () => {
    const env = environment();
    env.QA_PROTECTED_DATABASE_IDENTITIES_JSON = JSON.stringify([env.QA_DATABASE_IDENTITY]);
    assert.throws(() => assertQaDatabaseTarget(databaseUrl, { env }), /overlap/);
    assert.throws(() => assertQaDatabaseTarget(databaseUrl, { env: environment(), synchronize: true }), /synchronization/);
  });
  it('refuses live app, integration and SMTP destinations', () => {
    assert.throws(() => assertQaServiceTargets({ ...environment(), CORE_URL: 'https://demo.invalid' }), /CORE_URL/);
    assert.throws(() => assertQaServiceTargets({ ...environment(), FMS_URL: 'https://fms.invalid/calendar' }), /FMS_URL/);
    assert.throws(() => assertQaServiceTargets({ ...environment(), SMTP_HOST: 'smtp.invalid' }), /SMTP/);
  });
  it('refuses a protected service alias even when it appears in the QA map', () => {
    const env = environment();
    const services = JSON.parse(env.QA_SERVICES_JSON);
    services.frontend = config.protected.serviceOrigins[0];
    env.QA_SERVICES_JSON = JSON.stringify(services);
    assert.throws(() => assertQaServiceTargets(env), /protected environment/);
  });
  it('refuses missing QA metadata, live holiday imports and disabled authentication', () => {
    assert.throws(() => assertQaServiceTargets({ ...environment(), QA_TARGET_SET_ID: '' }), /QA_TARGET_SET_ID/);
    for (const value of ['true', '1', '', undefined]) assert.throws(() => assertQaServiceTargets({ ...environment(), HOLIDAY_AUTO_IMPORT: value }), /holiday imports/);
    for (const value of ['false', '0', 'no', 'off', '', undefined]) assert.throws(() => assertQaServiceTargets({ ...environment(), VERIFY_TOKENS: value }), /verification/);
    assert.throws(() => assertQaServiceTargets({ ...environment(), JWT_ISSUER: 'ccms-identity' }), /own token issuer/);
  });
  it('refuses absent service variables instead of allowing live fallback addresses', () => {
    for (const key of ['API_GATEWAY_URL', 'IDENTITY_JWKS_URL', 'LOGS_SERVICE_URL', 'OPERATIONS_URL']) {
      const env = environment();
      delete env[key];
      assert.throws(() => assertQaServiceTargets(env), /fallback addresses are refused/);
    }
  });
  it('requires HTTPS and non-loopback destinations for hosted QA', () => {
    assert.throws(() => assertQaServiceTargets({ ...environment(), QA_ENV_TYPE: 'hosted' }), /HTTPS/);
  });
  it('normalizes Neon pooled and direct database endpoints to the same identity', () => {
    assert.equal(qaDatabaseIdentity('postgres://qa:secret@ep-qa-pooler.region.neon.tech/qa'), qaDatabaseIdentity('postgres://qa:other@ep-qa.region.neon.tech:5432/qa'));
  });
  it('refuses Oversight role provisioning on a protected server, even with a different database name', () => {
    const env = environment();
    const identity = '127.0.0.1:5437/another_qa_database';
    const allowed = JSON.parse(env.QA_DATABASE_IDENTITIES_JSON);
    allowed[3] = identity;
    Object.assign(env, { QA_SERVICE_KIND: 'oversight-service', QA_DATABASE_IDENTITY: identity, QA_DATABASE_IDENTITIES_JSON: JSON.stringify(allowed) });
    assert.throws(() => assertQaDatabaseTarget('postgres://qa:qa@127.0.0.1:5437/another_qa_database', { env }), /isolated cluster/);
  });
});
