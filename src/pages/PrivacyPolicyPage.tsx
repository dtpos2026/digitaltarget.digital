// The privacy policy a customer can open without signing in (v1.110.0): #/privacy. It says what the software actually does with a
// customer's details — name, phone, address, location, orders — and how to ask for a copy or for erasure. The restaurant's name and
// contact come from its settings. A starting text, not legal advice: the owner should read it against the law of their country.
import { getSettings } from '@/lib/store';
import { ShieldCheck } from 'lucide-react';
import { PageTitle } from '@/components/layout/PageFrame';

export const PRIVACY_POLICY_UPDATED = '6 November 2026';

export const PRIVACY_SECTIONS: { id: string; title: string; body: string[] }[] = [
  { id: 'what', title: 'What we keep', body: [
    'When you order or are served, the restaurant keeps your name, phone number and — for delivery — your address and the place on the map you chose.',
    'It also keeps your orders: what you ordered, when, the total, tax and how you paid (cash, wallet or the payment provider’s own page).',
    'It does not keep your card number. Card details are entered on the payment provider’s page, never in this software.' ] },
  { id: 'why', title: 'Why we keep it', body: [
    'To take, prepare and deliver your order, to send you its receipt, and to answer you if something goes wrong.',
    'The restaurant must also keep a record of sales for its accounts and for the tax authority; that record is the sale itself and does not need your name.' ] },
  { id: 'share', title: 'Who sees it', body: [
    'The restaurant’s staff, and a delivery rider only for the orders they deliver (your name, phone and address for that order).',
    'The payment provider, if you pay online. Your details are never sold.' ] },
  { id: 'long', title: 'How long', body: [
    'Your profile is kept until you ask for it to be erased. Older orders are kept for as long as the restaurant’s accounts and the law require.' ] },
  { id: 'rights', title: 'Your choices', body: [
    'You may ask the restaurant for a copy of what it holds about you, to correct it, or to erase it.',
    'On erasure, your profile is deleted and your name, phone, address and map position are removed from your orders. The sales themselves (items, totals, tax) remain, because the restaurant’s books must stay complete.' ] },
  { id: 'safe', title: 'How it is protected', body: [
    'Each restaurant’s data is kept apart from every other restaurant’s on the server, and travels encrypted. Staff see only what their role allows.' ] },
];

export default function PrivacyPolicyPage() {
  const s = (() => { try { return getSettings(); } catch { return null; } })();
  const name = (s?.name || '').trim() || 'This restaurant';
  const contact = [s?.phone1, (s as { email?: string } | null)?.email].filter(Boolean).join(' · ');
  return (
    <main className="mx-auto max-w-2xl p-5 sm:p-8" data-testid="privacy-policy">
      <PageTitle icon={ShieldCheck} subtitle={`${name} · updated ${PRIVACY_POLICY_UPDATED}`}>Privacy policy</PageTitle>
      <p className="mt-4 text-sm text-muted-foreground">
        This explains in plain words what {name} keeps about you when you order or dine, and how you can ask for a copy or for it to be erased.
      </p>
      <div className="mt-6 space-y-6">
        {PRIVACY_SECTIONS.map(sec => (
          <section key={sec.id} id={sec.id}>
            <h2 className="text-base font-bold">{sec.title}</h2>
            {sec.body.map((p, i) => <p key={i} className="mt-1.5 text-sm leading-relaxed text-foreground/90">{p}</p>)}
          </section>
        ))}
        <section id="contact">
          <h2 className="text-base font-bold">Ask us</h2>
          <p className="mt-1.5 text-sm leading-relaxed">
            To see, correct or erase your details, contact {name}{contact ? <>: <b>{contact}</b></> : ' at the counter or on the phone number on your receipt'}.
            We will answer within 30 days.
          </p>
        </section>
      </div>
    </main>
  );
}
