import TableShell, { GroupRow, RowHeader, Table, Th } from '../ui/TableShell.js';
import { accessLabel, groupRows, hasAccess } from '../../lib/ui/account.js';

/**
 * The full role table, read-only. A cell that depends on a staff switch shows the switch's current value, so the matrix and the
 * switches above it never disagree. The only things a Super Admin can change are the four switches (not this table).
 */
export default function RolesMatrix({ matrix, switchOn }) {
  const cellText = (cell) => (cell && typeof cell === 'object' ? (switchOn[cell.switch] ? 'Yes (switch on)' : 'Off (switch off)') : accessLabel(cell));
  const tone = (cell) => (cell && typeof cell === 'object' ? (switchOn[cell.switch] ? 'text-emerald-700' : 'text-amber-800') : hasAccess(cell) ? 'text-slate-900' : 'text-slate-400');
  return (
    <TableShell>
      <Table
        label="Roles and permissions"
        minWidth="44rem"
        head={
          <tr>
            <Th>What</Th>
            {matrix.roles.map((r) => (
              <Th key={r.role}>{r.label}</Th>
            ))}
          </tr>
        }
      >
        {groupRows(matrix.rows).flatMap((group) => [
          <GroupRow key={`g-${group.name}`} colSpan={matrix.roles.length + 1}>{group.name}</GroupRow>,
          ...group.rows.map((row) => (
            <tr key={row.key} className="tr-row">
              <RowHeader className="whitespace-normal text-sm">{row.label}</RowHeader>
              {matrix.roles.map((r) => (
                <td key={r.role} className={`td text-sm font-semibold ${tone(row.cells[r.role])}`}>
                  {cellText(row.cells[r.role])}
                </td>
              ))}
            </tr>
          )),
        ])}
      </Table>
    </TableShell>
  );
}
