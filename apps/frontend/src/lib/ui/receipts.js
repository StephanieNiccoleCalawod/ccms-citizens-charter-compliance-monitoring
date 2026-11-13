// CC045 proof of payment: who sees it and the form checks (pure; the Operations service enforces every rule again).
import { ROLES } from 'ccms-shared/roles';

export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;
export const RECEIPT_ACCEPT = '.jpg,.jpeg,.png,image/jpeg,image/png';
export const EMPTY_RECEIPT_FORM = Object.freeze({ file: null, or_number: '', amount: '', receipt_date: '' });

/** Office Staff, Office Head and Super Admin. Executive never gets the section or its actions (the server answers 403 too). */
export const canSeeReceipts = (role) => [ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF].includes(role);

/** The same rules as the server, so most mistakes are caught before an upload. `today` is the Manila date (YYYY-MM-DD). */
export function receiptFormErrors(values, today) {
  const errors = {};
  const file = values.file;
  if (!file) errors.file = 'Choose a photo of the receipt.';
  else if (!/\.(jpe?g|png)$/i.test(file.name ?? '')) errors.file = 'Use a JPG or PNG photo.';
  else if (file.size === 0) errors.file = 'The file is empty.';
  else if (file.size > RECEIPT_MAX_BYTES) errors.file = 'The photo must be 2 MB or smaller.';
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,29}$/.test(values.or_number.trim())) errors.or_number = 'Enter the OR number: 1 to 30 letters, digits or dashes.';
  const amount = values.amount.trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount) || /^0*(\.0{0,2})?$/.test(amount)) errors.amount = 'Enter the amount paid, more than 0, with at most 2 decimals.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.receipt_date)) errors.receipt_date = 'Enter the date on the receipt.';
  else if (today && values.receipt_date > today) errors.receipt_date = 'The receipt date cannot be in the future.';
  return errors;
}

/** "₱1,234.50" from the server's fixed two-decimal string, without turning it into a float. */
export function formatAmount(amount) {
  if (typeof amount !== 'string' || !/^\d+\.\d{2}$/.test(amount)) return '-';
  const [whole, cents] = amount.split('.');
  return `₱${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`;
}

/** Field errors from a failed upload (400/413 details), keyed like the form. */
export function receiptFailure(error) {
  const fields = {};
  for (const key of ['file', 'or_number', 'amount', 'receipt_date']) if (typeof error?.details?.[key] === 'string') fields[key] = error.details[key];
  if (Object.keys(fields).length) return { fields, message: null };
  if (error?.status === 503) return { fields, message: error.message || 'Receipt photos cannot be stored right now. Please try again later.' };
  if (error?.status === 409) return { fields, message: error.message };
  if (error?.status === 403) return { fields, message: 'You do not have permission to manage receipts for this transaction.' };
  return { fields, message: error?.message || 'Something went wrong. Please try again.' };
}
