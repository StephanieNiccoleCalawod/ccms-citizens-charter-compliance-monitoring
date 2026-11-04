import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { MIN_PASSWORD_LENGTH } from './config.js';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/** Salted one-way hash: "scrypt$<salt>$<hash>" (base64). The password itself is never stored. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltText, hashText] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64');
  const derived = await scryptAsync(password, Buffer.from(saltText, 'base64'), expected.length);
  return timingSafeEqual(derived, expected);
}

let dummyHash;
/** Burns the same time as a real check so an unknown email is not distinguishable by speed. */
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('ccms-dummy-password');
  await verifyPassword(password, dummyHash);
}

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(password) {
  if (typeof password !== 'string' || password === '') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > 200) return 'Password must be 200 characters or fewer';
  return null;
}
