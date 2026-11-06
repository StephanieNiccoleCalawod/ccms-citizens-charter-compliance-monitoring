// What CCMS tells a person about a password they are choosing. The only hard limits are the ones Identity already enforces (at least 8
// and at most 200 characters); everything else is guidance. No character-mix rule is imposed: a long passphrase is encouraged instead.

export const PASSWORD_MIN = 8;
export const PASSWORD_RECOMMENDED = 16;
export const PASSWORD_MAX = 200;

/** The requirements shown under the field (a list the person can read before typing). */
export const PASSWORD_REQUIREMENTS = [
  'Use at least 16 characters if you can.',
  'A passphrase of 4–7 unrelated words is easy to remember and hard to guess.',
  'Uppercase and lowercase letters, numbers and symbols are all allowed, and none is required.',
  'The absolute minimum is 8 characters.',
];

/**
 * How the typed password stands: { level: 'empty' | 'error' | 'ok' | 'good', message, blocking }.
 * `blocking` is true only for what the server would refuse, so the form is never stricter than Identity.
 */
export function passwordStatus(password) {
  const value = typeof password === 'string' ? password : '';
  const length = [...value].length;
  if (length === 0) return { level: 'empty', message: '', blocking: false };
  if (length < PASSWORD_MIN) {
    return { level: 'error', message: `Password must be at least ${PASSWORD_MIN} characters (${length} so far).`, blocking: true };
  }
  if (length > PASSWORD_MAX) {
    return { level: 'error', message: `Password must be ${PASSWORD_MAX} characters or fewer.`, blocking: true };
  }
  if (length < PASSWORD_RECOMMENDED) {
    return { level: 'ok', message: `Accepted, but ${PASSWORD_RECOMMENDED} or more characters is recommended. Try a passphrase of 4–7 unrelated words.`, blocking: false };
  }
  return { level: 'good', message: 'Good length.', blocking: false };
}
