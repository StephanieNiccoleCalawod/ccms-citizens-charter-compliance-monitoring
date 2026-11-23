// One request for one click (S8-37). A write that is already on its way is not sent a second time: a second identical write made while the
// first has not answered yet (a double click, Enter pressed twice, a button that was not disabled in time) gets the answer of the first.
// This sits under every form, so a form that forgot its own guard is protected too. It is a second line: the server still refuses a duplicate
// where it can (Start answers 409 OPEN_TRANSACTION_EXISTS, a second Complete answers 409 "already completed").
//
// Only the same method, the same address and the same body count as "the same write". A read is never held back, and neither is an upload
// (a form with a file), which each screen guards itself.

/** The key of a write, or null when the request must always be sent (a read, an upload). */
export function writeKey(method, path, body, { isForm = false } = {}) {
  const verb = String(method ?? 'GET').toUpperCase();
  if (verb === 'GET' || verb === 'HEAD' || isForm) return null;
  let text = '';
  if (body !== undefined) {
    try {
      text = JSON.stringify(body);
    } catch {
      return null; // a body that cannot be compared is always sent
    }
  }
  return `${verb} ${path} ${text}`;
}

/**
 * Runs `start()` unless the same write (same key) is still running, in which case it returns that write's promise. The write is forgotten the
 * moment it settles, so a later, deliberate repeat is sent normally.
 */
export function singleFlight(inFlight, key, start) {
  if (key === null) return start();
  const running = inFlight.get(key);
  if (running) return running;
  const tracked = start().finally(() => {
    if (inFlight.get(key) === tracked) inFlight.delete(key);
  });
  inFlight.set(key, tracked);
  return tracked;
}
