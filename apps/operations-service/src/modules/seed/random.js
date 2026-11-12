import { createHash } from 'node:crypto';

// Deterministic randomness for the seed planner: the same seed text always gives the same sequence on every platform.

export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex');

/** sfc32, seeded from SHA-256 of the seed text and a stream name, so independent streams never shift each other. */
export function createRandom(seed, stream = 'main') {
  const h = createHash('sha256').update(`${seed}\u0000${stream}`).digest();
  let a = h.readUInt32LE(0);
  let b = h.readUInt32LE(4);
  let c = h.readUInt32LE(8);
  let d = h.readUInt32LE(12);
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i += 1) next();
  const random = {
    next,
    /** Integer in [0, n). */
    int: (n) => Math.floor(next() * n),
    /** Real number in [lo, hi). */
    between: (lo, hi) => lo + (hi - lo) * next(),
    pick: (items) => items[Math.floor(next() * items.length)],
    /** A shuffled copy (Fisher-Yates). */
    shuffle(items) {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return random;
}

/** A name-based UUID (RFC 9562 version 8 layout) from SHA-256: stable for the same name. */
export function uuidFromName(name) {
  const hex = sha256(name).slice(0, 32).split('');
  hex[12] = '8';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

/**
 * Integer apportionment by largest remainder: splits `total` over `weights` (object or Map of key -> weight >= 0).
 * Ties are broken by key order, so the result is deterministic. Returns a Map key -> count summing to total.
 */
export function apportion(total, weights) {
  const entries = [...(weights instanceof Map ? weights.entries() : Object.entries(weights))];
  const sum = entries.reduce((acc, [, w]) => acc + w, 0);
  const out = new Map(entries.map(([k]) => [k, 0]));
  if (total <= 0 || sum <= 0) return out;
  const parts = entries.map(([k, w], index) => {
    const exact = (total * w) / sum;
    return { k, floor: Math.floor(exact), rest: exact - Math.floor(exact), index };
  });
  let left = total - parts.reduce((acc, p) => acc + p.floor, 0);
  for (const p of parts) out.set(p.k, p.floor);
  const order = [...parts].sort((x, y) => y.rest - x.rest || x.index - y.index);
  for (const p of order) {
    if (left <= 0) break;
    out.set(p.k, out.get(p.k) + 1);
    left -= 1;
  }
  return out;
}

/**
 * Integer matrix with exact row and column totals, close to `weights` (rows x cols, >= 0): iterative proportional
 * fitting, then a deterministic rounding that keeps both margins. Throws when the margins disagree or cannot be met.
 */
export function balancedMatrix(rowTotals, colTotals, weights) {
  const R = rowTotals.length;
  const C = colTotals.length;
  const total = rowTotals.reduce((a, b) => a + b, 0);
  if (total !== colTotals.reduce((a, b) => a + b, 0)) throw new Error('Row and column totals differ');
  let m = weights.map((row) => row.map((w) => Math.max(w, 0)));
  for (let iteration = 0; iteration < 200; iteration += 1) {
    m = m.map((row, i) => {
      const s = row.reduce((a, b) => a + b, 0);
      return row.map((v) => (s > 0 ? (v * rowTotals[i]) / s : 0));
    });
    for (let j = 0; j < C; j += 1) {
      const s = m.reduce((a, row) => a + row[j], 0);
      for (let i = 0; i < R; i += 1) m[i][j] = s > 0 ? (m[i][j] * colTotals[j]) / s : 0;
    }
  }
  const out = m.map((row) => row.map((v) => Math.floor(v)));
  const rowLeft = rowTotals.map((t, i) => t - out[i].reduce((a, b) => a + b, 0));
  const colLeft = colTotals.map((t, j) => t - out.reduce((a, row) => a + row[j], 0));
  const cells = [];
  for (let i = 0; i < R; i += 1) for (let j = 0; j < C; j += 1) if (weights[i][j] > 0) cells.push({ i, j, rest: m[i][j] - out[i][j] });
  cells.sort((x, y) => y.rest - x.rest || x.i - y.i || x.j - y.j);
  for (let pass = 0; pass < 3 && rowLeft.some((v) => v > 0); pass += 1) {
    for (const cell of cells) {
      if (rowLeft[cell.i] > 0 && colLeft[cell.j] > 0) {
        out[cell.i][cell.j] += 1;
        rowLeft[cell.i] -= 1;
        colLeft[cell.j] -= 1;
      }
    }
  }
  if (rowLeft.some((v) => v !== 0) || colLeft.some((v) => v !== 0)) throw new Error('The office and month totals cannot both be met');
  return out;
}

/** Runs `fn` over items with at most `limit` in flight; results keep the input order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
