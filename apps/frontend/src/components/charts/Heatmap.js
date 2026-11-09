import { HEAT_BANDS, heatBand } from '../../lib/ui/analytics.js';
import TableShell, { Table, Th } from '../ui/TableShell.js';

const NO_DATA_FILL = 'repeating-linear-gradient(45deg,#f1efe9,#f1efe9 3px,#d9d6cc 3px,#d9d6cc 4px)';

// Compliance by office and period as a plain HTML table (a real table is the most accessible heatmap): one hue, light to dark,
// the number printed in every cell, a hover/focus tooltip, a legend of the colour bands, and a "no data" cell that is hatched
// (not just a different colour). It is the shared CCMS table: wide grids scroll sideways inside it and the office column stays in view.

export function HeatLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Colour legend">
      {HEAT_BANDS.map((b) => (
        <li key={b.label} className="inline-flex items-center gap-2 text-xs text-slate-700">
          <span aria-hidden="true" className="inline-block h-3.5 w-5 rounded-sm border border-black/10" style={{ background: b.bg }} />
          {b.label}
        </li>
      ))}
      <li className="inline-flex items-center gap-2 text-xs text-slate-700">
        <span aria-hidden="true" className="inline-block h-3.5 w-5 rounded-sm border border-black/10" style={{ background: NO_DATA_FILL }} />
        No data
      </li>
    </ul>
  );
}

export default function Heatmap({ periods, rows, caption }) {
  return (
    <TableShell>
      <Table
        label={caption}
        minWidth="34rem"
        head={
          <tr>
            <Th className="sticky left-0 z-10 bg-table-head">Office</Th>
            {periods.map((p) => (
              <Th key={p.key} align="center">{p.label}</Th>
            ))}
          </tr>
        }
      >
        {rows.map((row) => {
          const byPeriod = new Map(row.cells.map((c) => [c.period, c.value]));
          return (
            <tr key={row.officeId || row.officeName}>
              <td role="rowheader" className="td sticky left-0 z-10 whitespace-nowrap bg-white font-semibold text-slate-900">{row.officeName}</td>
              {periods.map((p) => {
                const value = byPeriod.get(p.key) ?? null;
                const band = heatBand(value);
                const label = `${row.officeName}, ${p.label}: ${value === null ? 'no data' : `${value}%`}`;
                return (
                  <td key={p.key} className="group relative p-0.5 text-center">
                    <div
                      tabIndex={0}
                      aria-label={label}
                      className="rounded-md px-1 py-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
                      style={band ? { background: band.bg, color: band.fg } : { background: NO_DATA_FILL, color: '#52514e' }}
                    >
                      {value === null ? '-' : `${value}%`}
                    </div>
                    <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-[#EAE3D9] bg-white px-3 py-1.5 text-xs text-slate-900 shadow-md group-focus-within:block group-hover:block">
                      {label}
                    </span>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </Table>
    </TableShell>
  );
}
