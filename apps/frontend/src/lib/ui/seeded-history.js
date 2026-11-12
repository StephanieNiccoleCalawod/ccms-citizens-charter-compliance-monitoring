// Sprint 6 TT1 / K16: the one disclosure line about the fictional (seeded) history, shown only in the Insights About
// panel. The period and the go-live date are deployment settings, not code:
//   NEXT_PUBLIC_SEEDED_HISTORY_FROM, NEXT_PUBLIC_SEEDED_HISTORY_TO, NEXT_PUBLIC_GO_LIVE_DATE  (YYYY-MM-DD each)
// Without all three valid dates no line is shown. Nowhere else in the screens says "simulated", "seed" or "test".
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const us = (value) => {
  const m = DATE.exec(String(value ?? '').trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
};

export function seededHistoryDisclosure(env = {
  from: process.env.NEXT_PUBLIC_SEEDED_HISTORY_FROM,
  to: process.env.NEXT_PUBLIC_SEEDED_HISTORY_TO,
  goLive: process.env.NEXT_PUBLIC_GO_LIVE_DATE,
}) {
  const from = us(env.from);
  const to = us(env.to);
  const goLive = us(env.goLive);
  if (!from || !to || !goLive) return null;
  return `Trained on simulated history from ${from} to ${to}, made for testing. Data from ${goLive} on is live.`;
}
