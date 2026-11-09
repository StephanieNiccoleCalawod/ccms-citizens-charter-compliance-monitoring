import {
  CARD_TITLE,
  DETAIL_CARD,
  DocumentNotes,
  GLANCE_EMPTY,
  GLANCE_LABEL,
  GLANCE_VALUE,
  NOT_SET,
  ProcedureStepList,
} from './ServiceDetailParts.js';
import { classificationLabel } from '../../lib/api/catalogue.js';
import { parseDocumentNotes, parseProcedureSteps } from '../../lib/ui/parseProcedure.js';

/**
 * A public service as citizens read it: office, name, procedure steps, required documents and the at-a-glance facts. Used by the
 * public page (/public/[id]) and by the "View requirements" modal on the home page, so both always show the same thing.
 * `embedded` draws the name as a level-2 heading (the modal already has the page's level-1 title).
 */
export default function PublicServiceView({ service, embedded = false, onClose }) {
  const Title = embedded ? 'h2' : 'h1';
  const steps = parseProcedureSteps(service.processing_steps);
  const hasNoFee = !service.fees || /^(none|no fee)$/i.test(service.fees.trim());
  const headerChip = 'rounded-full bg-slate-100 px-3.5 py-1.5 text-sm font-medium text-slate-700';
  return (
    <div className="space-y-6">
    <header className="relative border-y-2 border-[#971121] bg-white px-6 py-6 sm:px-8">
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close service requirements"
          className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-2xl font-semibold leading-none text-[#971121] transition hover:border-[#971121]/30 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#971121]"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
      <div className={onClose ? 'pr-12' : ''}>
        <p className="text-base font-medium text-slate-600">{service.office_name}</p>
        <Title className="mt-1 break-words font-serif text-2xl font-bold leading-tight text-[#86111C] sm:text-3xl">{service.service_name}</Title>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <span className={headerChip}>{classificationLabel(service.classification)} transaction</span>
          <span className={hasNoFee ? 'rounded-full bg-emerald-50 px-3.5 py-1.5 text-sm font-medium text-emerald-800' : headerChip}>{hasNoFee ? 'No fee' : service.fees}</span>
          {steps ? (
            <span className={headerChip}>
              {steps.length} {steps.length === 1 ? 'step' : 'steps'}
            </span>
          ) : null}
        </div>
      </div>
    </header>

    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <section className={DETAIL_CARD} aria-labelledby="procedure-heading">
          <h2 id="procedure-heading" className={CARD_TITLE}>Procedure steps</h2>
          <p className="mt-1 text-sm text-slate-500">Follow the steps in order. Each step shows where to go and who handles it.</p>
          {steps ? (
            <ProcedureStepList steps={steps} />
          ) : service.processing_steps ? (
            <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{service.processing_steps}</p>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No procedure steps have been published.</p>
          )}
        </section>

        <section className={DETAIL_CARD} aria-labelledby="documents-heading">
          <h2 id="documents-heading" className={CARD_TITLE}>Required documents</h2>
          <p className="mt-1 text-sm text-slate-500">What a citizen should bring. Mandatory items are marked.</p>
          {service.documents?.length ? (
            <ul className="mt-5 space-y-3">
              {service.documents.map((doc, index) => (
                <li key={index} className="rounded-xl border border-[#EAE3D9] p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 basis-60 font-semibold text-slate-900">{doc.document_name}</p>
                    {doc.is_mandatory ? (
                      <span className="badge shrink-0 bg-[#FFF4D9] text-[#9A6A00]">Mandatory</span>
                    ) : (
                      <span className="badge-inactive shrink-0">Optional</span>
                    )}
                  </div>
                  <DocumentNotes parts={parseDocumentNotes(doc.notes)} notes={doc.notes} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No documents are listed for this service.</p>
          )}
        </section>
      </div>

      <section className={DETAIL_CARD} aria-labelledby="glance-heading">
        <h2 id="glance-heading" className={CARD_TITLE}>At a glance</h2>
        <dl className="mt-4 space-y-4">
          <div>
            <dt className={GLANCE_LABEL}>Fees</dt>
            <dd className={service.fees ? 'mt-1 break-words text-2xl font-bold text-maroon-800' : GLANCE_EMPTY}>{service.fees || NOT_SET}</dd>
          </div>
          <div>
            <dt className={GLANCE_LABEL}>Who may avail</dt>
            <dd className={service.who_may_avail ? `${GLANCE_VALUE} whitespace-pre-wrap break-words` : GLANCE_EMPTY}>{service.who_may_avail || NOT_SET}</dd>
          </div>
          <div>
            <dt className={GLANCE_LABEL}>Classification</dt>
            <dd className={GLANCE_VALUE}>{classificationLabel(service.classification)}</dd>
          </div>
          <div>
            <dt className={GLANCE_LABEL}>Standard</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{service.standard_text}</dd>
          </div>
        </dl>
      </section>
    </div>
    </div>
  );
}
