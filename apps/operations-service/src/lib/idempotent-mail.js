// CC049 AC2: a mail transport with a DOCUMENTED idempotent send, for the acknowledgement email.
//
// Why not SMTP: SMTP has no idempotency operation. If the server accepts DATA and the worker dies before it records SENT,
// a retry sends a second copy; a stable Message-ID, a lock or a deduplicated queue cannot prevent that. So the
// acknowledgement is NEVER sent over SMTP. When no supported provider is configured it is not sent at all (it stays
// PENDING) and the printable slip remains the acknowledgement.
//
// Supported provider: Resend (HTTP API). Documented behaviour (resend.com/docs, "Idempotency keys"; checked 11/12/2026):
//   - header Idempotency-Key, 1-256 characters, kept for 24 hours;
//   - the same key with the same payload within 24 hours returns the original response without sending again;
//   - 409 concurrent_idempotent_requests: another request with that key is still in progress (retry later);
//   - 409 invalid_idempotent_request: same key, different payload (never retried here: our payload is deterministic).
// The worker therefore (1) uses one stable key per (transaction, kind) for every attempt and every worker, (2) builds a
// byte-identical payload from immutable columns, and (3) never sends a key whose first attempt is older than the safe
// window below; such a row ends FAILED with DEDUPE_WINDOW_EXPIRED for a person to review, instead of risking a duplicate.
//
// Settings (names only; values are secrets kept in the deployment, never in the repository):
//   ACK_EMAIL_PROVIDER   "resend" to enable; anything else (or empty) = disabled
//   RESEND_API_KEY       the provider API key
//   ACK_EMAIL_FROM       the verified sender, e.g. "PUP CCMS <no-reply@example.edu.ph>"
//   ACK_EMAIL_API_URL    optional override of https://api.resend.com (tests / a regional endpoint)

export const PROVIDER_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
// Stop retrying well inside the provider's window (clock skew, a slow last attempt).
export const SAFE_RETRY_WINDOW_MS = 20 * 60 * 60 * 1000;

export class TransportError extends Error {
  /** retryable: may be tried again with the same key; code: a short stored code (never a response body). */
  constructor(code, message, { retryable }) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function idempotentMailConfig(env = process.env) {
  const provider = String(env.ACK_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  return {
    provider,
    apiKey: env.RESEND_API_KEY ?? '',
    from: String(env.ACK_EMAIL_FROM ?? '').trim(),
    apiUrl: String(env.ACK_EMAIL_API_URL ?? 'https://api.resend.com').trim().replace(/\/+$/, ''),
  };
}

/**
 * { configured, reason?, send({ to, subject, text, idempotencyKey }) -> { providerMessageId } }.
 * send() throws TransportError. It never falls back to SMTP.
 */
export function createIdempotentMailTransport({ provider, apiKey, from, apiUrl = 'https://api.resend.com', fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (provider !== 'resend') return { configured: false, reason: 'ACK_EMAIL_PROVIDER is not set to a supported idempotent provider', async send() { throw new TransportError('NOT_CONFIGURED', 'Not configured', { retryable: true }); } };
  if (!apiKey || !from) return { configured: false, reason: 'RESEND_API_KEY and ACK_EMAIL_FROM are required', async send() { throw new TransportError('NOT_CONFIGURED', 'Not configured', { retryable: true }); } };

  return {
    configured: true,
    provider,
    async send({ to, subject, text, idempotencyKey }) {
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 256) {
        throw new TransportError('INVALID_KEY', 'Idempotency key must be 1-256 characters', { retryable: false });
      }
      let response;
      try {
        response = await fetchImpl(`${apiUrl}/emails`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        // The request may or may not have reached the provider: retrying with the same key is the documented recovery.
        throw new TransportError(timedOut ? 'TIMEOUT' : 'NETWORK', 'The mail provider could not be reached', { retryable: true });
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        /* not JSON */
      }
      if (response.ok) {
        const id = typeof payload?.id === 'string' && payload.id.length <= 200 ? payload.id : null;
        // Accepted. An unreadable id does not make it unsent: the key stays the reconciliation handle.
        return { providerMessageId: id };
      }
      const name = typeof payload?.name === 'string' ? payload.name : '';
      if (response.status === 409 && name === 'concurrent_idempotent_requests') {
        throw new TransportError('IN_PROGRESS', 'Another attempt with this key is in progress', { retryable: true });
      }
      if (response.status === 409) throw new TransportError('IDEMPOTENCY_CONFLICT', 'The provider refused the key for a different payload', { retryable: false });
      if (response.status === 429 || response.status >= 500) {
        throw new TransportError(`HTTP_${response.status}`, 'The mail provider is busy or failing', { retryable: true });
      }
      // 400/401/403/422 and the like: configuration or address problems. Not retried automatically.
      throw new TransportError(`HTTP_${response.status}`, 'The mail provider refused the message', { retryable: false });
    },
  };
}

export const getIdempotentMailTransport = () => createIdempotentMailTransport(idempotentMailConfig());
