// Matching for the searchable dropdown, as a pure function so it can be tested directly.

/** The options whose text contains what was typed (case-insensitive). Each option's `search` text is used, else its label and secondary line. */
export function filterOptions(options, query) {
  const text = String(query ?? '').trim().toLowerCase();
  if (!text) return options;
  return options.filter((o) => (o.search ?? `${o.label} ${o.secondary ?? ''}`).toLowerCase().includes(text));
}

// Options marked `disabled` (an inactive record) stay in the list but are never highlighted, stepped onto or chosen.
/** The index of the first option that can be chosen, or -1. */
export const firstEnabled = (options) => options.findIndex((o) => !o.disabled);

/** The index of the last option that can be chosen, or -1. */
export function lastEnabled(options) {
  for (let i = options.length - 1; i >= 0; i -= 1) if (!options[i].disabled) return i;
  return -1;
}

/** The next chooseable index after `from` in the direction (1 down, -1 up), wrapping round; `from` when nothing can be chosen. */
export function stepEnabled(options, from, direction) {
  const n = options.length;
  for (let k = 1; k <= n; k += 1) {
    const i = (((from + direction * k) % n) + n) % n;
    if (!options[i].disabled) return i;
  }
  return from;
}
