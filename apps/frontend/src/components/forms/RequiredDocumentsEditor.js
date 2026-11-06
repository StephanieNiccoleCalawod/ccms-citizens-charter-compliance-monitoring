'use client';

import { DOCUMENT_NAME_MAX, DOCUMENT_NOTES_MAX, addDocumentRow, removeDocumentRow, setDocumentRow } from '../../lib/ui/service-form.js';

/**
 * The "Required documents" list on the Add Service form: one row per document with its name, a Required tick and optional notes.
 * Names only: no file is uploaded. The rows are saved together with the service. An empty list is fine.
 */
export default function RequiredDocumentsEditor({ id, documents, onChange, describedBy }) {
  return (
    <div className="space-y-3" data-field="documents" tabIndex={-1}>
      {documents.length === 0 ? <p className="text-sm text-slate-500">No documents yet. You can also add them later on the service page.</p> : null}
      <ul className="space-y-3" aria-label="Required documents">
        {documents.map((doc, index) => (
          <li key={index} className="rounded-md border border-slate-200 bg-white p-3">
            <div className="flex items-start gap-2">
              <div className="grow">
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${id}-doc-${index}-name`}>
                  Document {index + 1} name
                </label>
                <input
                  id={`${id}-doc-${index}-name`}
                  data-doc={index}
                  className="input"
                  value={doc.document_name}
                  maxLength={DOCUMENT_NAME_MAX}
                  onChange={(e) => onChange(setDocumentRow(documents, index, { document_name: e.target.value }))}
                  aria-describedby={describedBy}
                />
              </div>
              <button type="button" className="btn-secondary mt-5" onClick={() => onChange(removeDocumentRow(documents, index))} aria-label={`Remove document ${index + 1}`}>
                Remove
              </button>
            </div>
            <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={doc.is_mandatory} onChange={(e) => onChange(setDocumentRow(documents, index, { is_mandatory: e.target.checked }))} />
              Required (the client must bring it)
            </label>
            <div className="mt-2">
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor={`${id}-doc-${index}-notes`}>
                Notes (optional)
              </label>
              <input
                id={`${id}-doc-${index}-notes`}
                className="input"
                value={doc.notes}
                maxLength={DOCUMENT_NOTES_MAX}
                onChange={(e) => onChange(setDocumentRow(documents, index, { notes: e.target.value }))}
              />
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="btn-secondary" onClick={() => onChange(addDocumentRow(documents))}>
        + Add document
      </button>
    </div>
  );
}
