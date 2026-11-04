import { splitLinks } from '../../lib/ui/parseProcedure.js';

// Presentation pieces for the Service Details layout, used by the public service page.
// They only read the fields they are given; nothing here fetches or invents data.

export const NOT_SET = 'Not set';
export const DETAIL_CARD = 'rounded-2xl border border-[#EAE3D9] bg-white p-6';
export const CARD_TITLE = 'font-sans text-xl font-bold text-maroon-900';
export const HEADER_CHIP = 'rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white';
export const GLANCE_LABEL = 'text-xs font-bold uppercase tracking-wider text-slate-500';
export const GLANCE_VALUE = 'mt-1 text-sm text-slate-900';
export const GLANCE_EMPTY = 'mt-1 text-sm text-slate-500';

// Text with any http(s) addresses turned into links; everything else stays plain text.
export function LinkedText({ text, linkLabel }) {
  return splitLinks(text).map((part, i) =>
    part.href ? (
      <a key={i} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-maroon-800 underline">
        {linkLabel ?? part.href}
      </a>
    ) : (
      <span key={i}>{linkLabel ? part.text.replace(/[\s\-–·]+$/, ' ') : part.text}</span>
    ),
  );
}

// Numbered steps with their sub-steps and responsible roles (steps come from parseProcedureSteps).
export function ProcedureStepList({ steps }) {
  return (
    <ol className="mt-6 space-y-6">
      {steps.map((step) => (
        <li key={step.number} className="flex gap-4">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-800 text-sm font-bold text-white">
            {step.number}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">
              <span className="sr-only">Step {step.number}: </span>
              {step.title}
              {step.aside ? <span className="ml-1 text-sm font-normal text-slate-500">{step.aside}</span> : null}
            </p>
            {step.location ? (
              <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-500">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z" />
                  <circle cx="10" cy="8" r="2" />
                </svg>
                <span>{step.location}</span>
              </p>
            ) : null}
            {step.instruction ? <p className="mt-1 text-sm text-slate-500">{step.instruction}</p> : null}
            {step.substeps.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {step.substeps.map((sub) => (
                  <li key={sub.label} className="rounded-xl bg-[#FAF7F2] px-4 py-3 text-sm text-slate-800">
                    <p>
                      <span className="font-bold text-maroon-800">{sub.label}</span> {sub.text}
                    </p>
                    {sub.roles.length > 0 ? (
                      <p className="mt-1.5 flex flex-wrap gap-1.5">
                        {sub.roles.map((role) => (
                          <span key={role} className="rounded-full bg-maroon-100 px-2.5 py-0.5 text-xs font-semibold text-maroon-800">
                            {role}
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

// Copies / Where to secure / Remarks for one document, or its notes as written when they have no labels.
export function DocumentNotes({ parts, notes }) {
  if (parts) {
    return (
      <dl className="mt-3 space-y-2 text-sm text-slate-700">
        {parts.copies ? (
          <div>
            <dt className="inline font-bold text-slate-900">Copies: </dt>
            <dd className="inline">{parts.copies}</dd>
          </div>
        ) : null}
        {parts.where ? (
          <div>
            <dt className="inline font-bold text-slate-900">Where to secure: </dt>
            <dd className="inline">
              <LinkedText text={parts.where} linkLabel="Open link" />
            </dd>
          </div>
        ) : null}
        {parts.remarks ? (
          <div>
            <dt className="inline font-bold text-slate-900">Remarks: </dt>
            <dd className="inline">
              <LinkedText text={parts.remarks} />
            </dd>
          </div>
        ) : null}
      </dl>
    );
  }
  if (!notes) return null;
  return (
    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
      <LinkedText text={notes} />
    </p>
  );
}
