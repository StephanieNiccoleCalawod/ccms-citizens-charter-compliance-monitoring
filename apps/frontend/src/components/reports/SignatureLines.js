import { SIGNATURE_LINES } from '../../lib/ui/reports.js';

/** AC-10: a blank line per signatory with their title below, no printed names. Shown on both report sheets. */
export default function SignatureLines({ allOffices = false }) {
  const preparedBy = allOffices ? SIGNATURE_LINES.preparedByAllOffices : SIGNATURE_LINES.preparedBy;
  return (
    <div className="mt-8 grid gap-8 text-sm sm:grid-cols-2" data-testid="signature-lines">
      <div>
        <div className="h-10 border-b border-slate-400" />
        <p className="mt-1 font-semibold">{SIGNATURE_LINES.preparedByLabel}</p>
        {preparedBy ? <p className="text-slate-600">{preparedBy}</p> : null}
      </div>
      <div>
        <div className="h-10 border-b border-slate-400" />
        <p className="mt-1 font-semibold">{SIGNATURE_LINES.notedByLabel}</p>
        {SIGNATURE_LINES.notedBy ? <p className="text-slate-600">{SIGNATURE_LINES.notedBy}</p> : null}
      </div>
    </div>
  );
}
