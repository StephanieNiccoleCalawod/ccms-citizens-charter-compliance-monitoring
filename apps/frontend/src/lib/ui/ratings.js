// Rating rules (CC057). The server checks everything again; this only catches mistakes before the call.
export const STAR_VALUES = Object.freeze([1, 2, 3, 4, 5]);
export const STAR_LABEL = Object.freeze({ 1: 'Very poor', 2: 'Poor', 3: 'Fair', 4: 'Good', 5: 'Excellent' });
export const CODE_LENGTH = 12;
export const CODE_CHARS = /^[A-HJ-KM-NP-Z2-9]+$/;

/** What the citizen typed, tidied: upper case, no spaces or dashes, at most 12 characters. */
export const cleanCode = (value) => String(value ?? '').toUpperCase().replace(/[\s-]/g, '').slice(0, CODE_LENGTH);
/** Shown as XXXX-XXXX-XXXX while typing. */
export const showCode = (value) => cleanCode(value).replace(/(.{4})(?=.)/g, '$1-');

export function ratingErrors({ code, stars }) {
  const errors = {};
  const clean = cleanCode(code);
  if (clean.length !== CODE_LENGTH || !CODE_CHARS.test(clean)) errors.code = 'Enter the 12-character code from your receipt.';
  if (!STAR_VALUES.includes(stars)) errors.stars = 'Choose 1 to 5 stars.';
  return errors;
}

export function ratingFailure(error) {
  if (error?.status === 409) return 'This code is not valid or has already been used.';
  if (error?.status === 429) return error.message;
  return error?.message || 'Something went wrong. Please try again in a few minutes.';
}

export const averageText = (average) => (average === null || average === undefined ? '–' : `${Number(average).toFixed(2)} / 5`);
