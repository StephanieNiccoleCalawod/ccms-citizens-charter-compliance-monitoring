import PublicHeader from '../../components/layout/PublicHeader.js';
import PublicFooter from '../../components/layout/PublicFooter.js';
import { CONTACT } from '../../lib/constants/contact.js';

export const metadata = { title: 'Privacy notice | CCCMS' };

// The privacy notice (Data Privacy Act, RA 10173, transparency principle). Plain words: what is collected, why, who sees it, how long, and
// who to ask. The retention period is not confirmed yet, so the page says so instead of naming a number.
const SECTIONS = [
  { title: 'What data we collect', body: [
    'Staff and office accounts: name, email address and role.',
    'A citizen’s email address, only if you give it so we can send the acknowledgement or receipt of your transaction.',
    'Complaint details: what you write, the tracking number and, if you give them, your name and email address.',
    'Service ratings are anonymous. A rating is linked to a one-time code, not to your name.',
  ] },
  { title: 'Why we collect it', body: [
    'To process transactions and give you your acknowledgement and receipt.',
    'To check whether the office keeps the promised processing times of the Citizen’s Charter.',
    'To receive, route and answer complaints.',
  ] },
  { title: 'Who can see it', body: [
    'Office staff see the transactions of their own work. The Office Head sees their office. The Super Admin sees the whole system.',
    'The Executive sees reports and totals, without staff or client details.',
    'A citizen’s email address and complaint details are seen only by the people who handle that transaction or complaint.',
  ] },
  { title: 'How long we keep it, and your rights', body: [
    'The retention period is still being confirmed by the university. This page will state it once it is approved.',
    'You may ask us to correct data about you that is wrong, or to delete data we no longer need. Write to the contact below.',
  ] },
];

export default function PrivacyPage() {
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-10" data-testid="privacy-page">
        <h1 className="text-2xl font-bold text-maroon-950">Privacy notice</h1>
        <p className="mt-2 text-sm text-slate-600">This notice tells you what personal data CCCMS holds and what we do with it, as the Data Privacy Act of 2012 (RA 10173) asks us to.</p>
        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-6" aria-labelledby={`p-${section.title}`}>
            <h2 id={`p-${section.title}`} className="text-lg font-semibold text-slate-900">{section.title}</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{section.body.map((line) => <li key={line}>{line}</li>)}</ul>
          </section>
        ))}
        <section className="mt-6" aria-labelledby="p-contact">
          <h2 id="p-contact" className="text-lg font-semibold text-slate-900">Who to contact about privacy</h2>
          <address className="mt-2 text-sm not-italic text-slate-700">
            <p>{CONTACT.university}</p>
            <p><a className="underline" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></p>
            <p>Phone: {CONTACT.phone}</p>
            <p>{CONTACT.address}</p>
          </address>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}
