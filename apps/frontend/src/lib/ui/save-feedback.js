// What CCMS tells the person after a save, in one place: the success sentence for an operation, and the one error sentence for a
// failed request. The server's own words are kept whenever they are safe and clear (for example "Office code already exists");
// stack traces, SQL or internal text never reach the screen, and a field error is shown under its field, with a short prompt here.

export const MESSAGES = {
  validation: 'Please check the highlighted fields and try again.',
  duplicate: 'This record already exists.',
  unauthorized: 'You are not authorized to perform this action.',
  network: 'Unable to connect to the server. Please try again.',
  server: 'Something went wrong while saving. Please try again.',
  unknown: 'Failed to save changes. Please try again.',
};

/** "Office created successfully." / "Holiday updated successfully." (op: created | updated | deleted | deactivated | reactivated ...). */
export function savedMessage(entity, op = 'created') {
  const name = String(entity ?? 'Record').trim() || 'Record';
  return `${name[0].toUpperCase()}${name.slice(1)} ${op} successfully.`;
}

// Text that looks like it came from the inside of a server (a path, a stack, SQL, an error class) is never shown.
const UNSAFE = new RegExp(
  [
    String.raw`\.(js|jsx|ts|mjs):\d+`, // a file and line
    String.raw`^\s*at\s+\S+\s*\(`, // a stack frame
    String.raw`\bat\s+\S+\.(js|ts|mjs)\b`,
    'node_modules',
    String.raw`\bSELECT\b`,
    String.raw`\bINSERT\b`,
    String.raw`\bUPDATE\b.+\bSET\b`,
    String.raw`\bDELETE\s+FROM\b`,
    'relation ".*" does not exist',
    'ECONN',
    'stack',
    'TypeError',
    'ReferenceError',
    'undefined',
    String.raw`\[object`,
    '/srv/',
    String.raw`[A-Za-z]:\\`, // a Windows path
  ].join('|'),
  'i',
);
const isSafeText = (text) => typeof text === 'string' && text.trim() !== '' && text.length <= 300 && !UNSAFE.test(text);

/**
 * The one sentence for a failed save (an ApiError: status, code, message, details).
 *  - 401 / 403 -> not authorized;  no connection -> unable to connect;  5xx -> something went wrong while saving
 *  - 409 -> the server's own sentence (it says what already exists), else "This record already exists."
 *  - 400 / 422 with field errors -> the prompt to check the highlighted fields (the details are under the fields)
 *  - otherwise the page's own sentence (`specific`), then the server's, when safe; else "Failed to save changes."
 */
export function saveFailureMessage(err, specific = null) {
  const status = err?.status;
  if (status === 401 || status === 403) return MESSAGES.unauthorized;
  if (err?.code === 'NETWORK_ERROR' || status === 0) return MESSAGES.network;
  if (typeof status === 'number' && status >= 500) return MESSAGES.server;
  if (status === 409) return isSafeText(err?.message) ? err.message : MESSAGES.duplicate;
  const hasFields = err?.details && typeof err.details === 'object' && Object.keys(err.details).length > 0;
  if ((status === 400 || status === 422) && hasFields) return MESSAGES.validation;
  if (isSafeText(specific)) return specific;
  if (typeof status === 'number' && status >= 400 && isSafeText(err?.message)) return err.message;
  return MESSAGES.unknown;
}
