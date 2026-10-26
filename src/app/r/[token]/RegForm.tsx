'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { JOB_TYPES, PPE_OPTIONS } from '@/lib/format';
import { AVAILABILITY, TRANSPORT } from '@/lib/regOptions';
import { prepareFile, uploadToSlot, OK_TYPES } from '@/lib/upload';
import { startUploads, submitRegistration, type RegData } from './actions';

type Doc = { title: string; body: string };
type Props = {
  token: string; first: string; last: string; mobile: string; jobTypes: string[];
  docs: { kid: Doc; terms: Doc; privacy: Doc; wtr: Doc };
};
type FileKind = 'passport' | 'flt_licence' | 'ni_proof' | 'other';

function Section({ n, title, children, note }: { n: number; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card"><div className="in">
      <h2 className="sech"><span className="secn">{n}</span>{title}</h2>
      {note && <p className="note" style={{ margin: 0 }}>{note}</p>}
      {children}
    </div></section>
  );
}

function YesNo({ name, value, onChange, yes = 'Yes', no = 'No' }: { name: string; value: boolean | null; onChange: (v: boolean) => void; yes?: string; no?: string }) {
  return (
    <div className="yn">
      <label className="tick"><input type="radio" name={name} checked={value === true} onChange={() => onChange(true)} /> {yes}</label>
      <label className="tick"><input type="radio" name={name} checked={value === false} onChange={() => onChange(false)} /> {no}</label>
    </div>
  );
}

function DocRead({ doc, checked, onChange, label }: { doc: Doc; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="docread">
      <details><summary>Read the {doc.title}</summary><div className="docbox">{doc.body}</div></details>
      <label className="tick"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}</label>
    </div>
  );
}

export function RegForm(p: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [stage, setStage] = useState('');
  const [d, setD] = useState<RegData>({
    first: p.first, last: p.last, dob: '', email: '', address1: '', address2: '', town: '', postcode: '', ni: '',
    jobTypes: p.jobTypes, experience: '', transport: '', ownPpe: [], availability: [],
    rtwRoute: '', shareCode: '', nokName: '', nokRelationship: '', nokPhone: '',
    healthDeclared: null, healthDetails: '', convictionsDeclared: null, convictionsDetails: '', wtrOptOut: null,
    readKid: false, readTerms: false, readPrivacy: false, messagesConsent: true, signature: '',
  });
  const [files, setFiles] = useState<Partial<Record<FileKind, File>>>({});
  const set = <K extends keyof RegData>(k: K, v: RegData[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'jobTypes' | 'ownPpe' | 'availability', v: string) =>
    setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  function pick(kind: FileKind, f: File | undefined) {
    setErr('');
    if (!f) return;
    if (f.type && !OK_TYPES.includes(f.type)) return setErr('Please choose a photo or a PDF.');
    setFiles((x) => ({ ...x, [kind]: f }));
  }

  function FilePick({ kind, label }: { kind: FileKind; label: string }) {
    const f = files[kind];
    return (
      <div className="filepick">
        <label className={f ? 'btn ghost' : 'btn'} htmlFor={`file-${kind}`}>{f ? 'Change photo' : label}</label>
        <input id={`file-${kind}`} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { pick(kind, e.target.files?.[0]); e.target.value = ''; }} />
        {f && <span className="note">✓ {f.name}</span>}
      </div>
    );
  }

  function submit() {
    setErr('');
    if (!files.ni_proof) return setErr('Please add a photo of your proof of NI number (section 1).');
    if (d.rtwRoute === 'british_irish' && !files.passport) return setErr('Please add a photo of your passport (section 3).');
    if (d.jobTypes.includes('FLT counterbalance') && !files.flt_licence) return setErr('Please add a photo of your FLT licence (section 3).');
    start(async () => {
      try {
        const chosen = (Object.entries(files) as [FileKind, File][]).filter(([k]) => k !== 'flt_licence' || d.jobTypes.includes('FLT counterbalance'));
        const prepared = await Promise.all(chosen.map(async ([kind, f]) => ({ kind, ...(await prepareFile(f)) })));
        let uploads: { kind: string; path: string; filename: string }[] = [];
        if (prepared.length) {
          setStage('Uploading photos…');
          const s = await startUploads(p.token, prepared.map((x) => ({ kind: x.kind, type: x.type, size: x.blob.size })));
          if (!s.ok) { setStage(''); return setErr(s.error); }
          const done = await Promise.all(prepared.map((x, i) => uploadToSlot(s.slots[i].path, s.slots[i].token, x.blob, x.type)));
          if (done.some((ok) => !ok)) { setStage(''); return setErr('A photo didn’t upload. Check your signal and try again.'); }
          uploads = prepared.map((x, i) => ({ kind: x.kind, path: s.slots[i].path, filename: x.name }));
        }
        setStage('Saving your details…');
        const r = await submitRegistration(p.token, d, uploads);
        setStage('');
        if (!r.ok) return setErr(r.error ?? 'Something went wrong. Please try again.');
        window.scrollTo(0, 0);
        router.refresh();
      } catch {
        setStage('');
        setErr('Something went wrong. Check your signal and try again.');
      }
    });
  }

  return (
    <>
      <div className="state" style={{ textAlign: 'left', alignItems: 'stretch' }}>
        <div className="big">Register with Staff Selection UK</div>
        <p>Hi {p.first}. This takes about 10 minutes. Have your share code or passport ready. Your details are kept private and only used to find you work.</p>
      </div>

      <Section n={1} title="About you">
        <div className="form">
          <div className="f"><label className="l" htmlFor="first">First name</label><input id="first" type="text" autoComplete="given-name" value={d.first} onChange={(e) => set('first', e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="last">Surname</label><input id="last" type="text" autoComplete="family-name" value={d.last} onChange={(e) => set('last', e.target.value)} /></div>
          <div className="f w4"><label className="l" htmlFor="dob">Date of birth</label><input id="dob" type="date" autoComplete="bday" value={d.dob} onChange={(e) => set('dob', e.target.value)} /></div>
          <div className="f w4"><span className="l">Mobile</span><div className="note" style={{ fontSize: 15 }}>{p.mobile} <span className="note">(call the office to change it)</span></div></div>
          <div className="f w4"><label className="l" htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="f w4"><label className="l" htmlFor="a1">Address</label><input id="a1" type="text" autoComplete="address-line1" placeholder="House number and street" value={d.address1} onChange={(e) => set('address1', e.target.value)} /></div>
          <div className="f w4"><input aria-label="Address line 2" type="text" autoComplete="address-line2" placeholder="Area (optional)" value={d.address2} onChange={(e) => set('address2', e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="town">Town</label><input id="town" type="text" autoComplete="address-level2" value={d.town} onChange={(e) => set('town', e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="pc">Postcode</label><input id="pc" type="text" autoComplete="postal-code" autoCapitalize="characters" value={d.postcode} onChange={(e) => set('postcode', e.target.value)} /></div>
          <div className="f w4"><label className="l" htmlFor="ni">National Insurance number</label><input id="ni" type="text" autoCapitalize="characters" placeholder="QQ 12 34 56 C" value={d.ni} onChange={(e) => set('ni', e.target.value)} /></div>
          <div className="f w4"><span className="l">Proof of your NI number</span><FilePick kind="ni_proof" label="Take or choose photo" />
            <span className="note">A photo of an old payslip, P45, P60 or NI letter or card that shows your number.</span></div>
        </div>
      </Section>

      <Section n={2} title="Work">
        <div className="f"><span className="l">What work can you do?</span>
          <div className="chips">{JOB_TYPES.map((t) => <label key={t} className="chip"><input type="checkbox" checked={d.jobTypes.includes(t)} onChange={() => toggle('jobTypes', t)} /> {t}</label>)}</div></div>
        <div className="f"><label className="l" htmlFor="exp">Your experience</label>
          <textarea id="exp" placeholder="e.g. 2 years picking and packing at a food warehouse" value={d.experience} onChange={(e) => set('experience', e.target.value)} /></div>
        <div className="f"><span className="l">When can you work?</span>
          <div className="chips">{AVAILABILITY.map((t) => <label key={t} className="chip"><input type="checkbox" checked={d.availability.includes(t)} onChange={() => toggle('availability', t)} /> {t}</label>)}</div></div>
        <div className="f"><label className="l" htmlFor="tr">How will you get to work?</label>
          <select id="tr" value={d.transport} onChange={(e) => set('transport', e.target.value)}><option value="">Choose…</option>{TRANSPORT.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="f"><span className="l">Safety kit you already have</span>
          <div className="chips">{PPE_OPTIONS.map((t) => <label key={t} className="chip"><input type="checkbox" checked={d.ownPpe.includes(t)} onChange={() => setD((x) => ({ ...x, ownPpe: x.ownPpe.includes(t) ? x.ownPpe.filter((y) => y !== t) : [...x.ownPpe.filter((y) => y !== 'None'), t] }))} /> {t}</label>)}
            <label className="chip"><input type="checkbox" checked={d.ownPpe.includes('None')} onChange={() => setD((x) => ({ ...x, ownPpe: x.ownPpe.includes('None') ? [] : ['None'] }))} /> None yet</label></div></div>
      </Section>

      <Section n={3} title="Right to work" note="By law we must check you can work in the UK before you start.">
        <div className="yn" style={{ gridTemplateColumns: '1fr' }}>
          <label className="tick"><input type="radio" name="rtw" checked={d.rtwRoute === 'share_code'} onChange={() => set('rtwRoute', 'share_code')} /> I have a share code (eVisa or settled status)</label>
          <label className="tick"><input type="radio" name="rtw" checked={d.rtwRoute === 'british_irish'} onChange={() => set('rtwRoute', 'british_irish')} /> I have a British or Irish passport</label>
        </div>
        {d.rtwRoute === 'share_code' && (
          <div className="f"><label className="l" htmlFor="sc">Your share code</label>
            <input id="sc" type="text" autoCapitalize="characters" placeholder="e.g. W2X 4YZ 7AB" value={d.shareCode} onChange={(e) => set('shareCode', e.target.value)} />
            <span className="note">Get it free at gov.uk/prove-right-to-work. Choose “to an employer”. It lasts 90 days.</span></div>
        )}
        {d.rtwRoute === 'british_irish' && (
          <div className="f"><span className="l">Photo of your passport’s photo page</span><FilePick kind="passport" label="Take or choose photo" />
            <span className="note">We’ll also need to see the original passport, in person or on a video call.</span></div>
        )}
        {d.jobTypes.includes('FLT counterbalance') && (
          <div className="f"><span className="l">FLT licence or certificate</span><FilePick kind="flt_licence" label="Take or choose photo" /></div>
        )}
      </Section>

      <Section n={4} title="Emergency contact" note="Who should we call if something happens to you at work?">
        <div className="form">
          <div className="f w2"><label className="l" htmlFor="nk">Name</label><input id="nk" type="text" value={d.nokName} onChange={(e) => set('nokName', e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="nkr">Relationship</label><input id="nkr" type="text" placeholder="e.g. Partner" value={d.nokRelationship} onChange={(e) => set('nokRelationship', e.target.value)} /></div>
          <div className="f"><label className="l" htmlFor="nkp">Phone</label><input id="nkp" type="tel" value={d.nokPhone} onChange={(e) => set('nokPhone', e.target.value)} /></div>
        </div>
      </Section>

      <Section n={5} title="Health and safety" note="Only seen by our admin team. Telling us helps us keep you safe and doesn’t stop you getting work.">
        <p style={{ margin: 0 }}>Is there anything we should know to keep you safe at work, or any adjustments you need?</p>
        <YesNo name="health" value={d.healthDeclared} onChange={(v) => set('healthDeclared', v)} no="No" yes="Yes" />
        {d.healthDeclared && <textarea aria-label="Health details" placeholder="Tell us what we need to know, or write “call me” and we’ll talk it through." value={d.healthDetails} onChange={(e) => set('healthDetails', e.target.value)} />}
      </Section>

      <Section n={6} title="Criminal convictions" note="Only seen by our admin team. Having a conviction doesn’t automatically stop you working with us.">
        <p style={{ margin: 0 }}>Do you have any <b>unspent</b> criminal convictions?</p>
        <p className="note" style={{ margin: 0 }}>You don’t need to tell us about spent convictions. Most convictions become spent after a set time under the Rehabilitation of Offenders Act.</p>
        <YesNo name="conv" value={d.convictionsDeclared} onChange={(v) => set('convictionsDeclared', v)} />
        {d.convictionsDeclared && <textarea aria-label="Conviction details" placeholder="Offence and date, or write “call me”." value={d.convictionsDetails} onChange={(e) => set('convictionsDetails', e.target.value)} />}
      </Section>

      <Section n={7} title="48-hour working week" note="This is your choice. It won’t affect whether we offer you work.">
        <details><summary>Read about opting out</summary><div className="docbox">{p.docs.wtr.body}</div></details>
        <YesNo name="wtr" value={d.wtrOptOut} onChange={(v) => set('wtrOptOut', v)} yes="I want to opt out of the 48-hour limit" no="Keep the 48-hour limit" />
      </Section>

      <Section n={8} title="Agreements">
        <DocRead doc={p.docs.kid} checked={d.readKid} onChange={(v) => set('readKid', v)} label="I’ve read the Key Information Document" />
        <DocRead doc={p.docs.terms} checked={d.readTerms} onChange={(v) => set('readTerms', v)} label="I’ve read and agree to the terms of engagement" />
        <DocRead doc={p.docs.privacy} checked={d.readPrivacy} onChange={(v) => set('readPrivacy', v)} label="I’ve read the privacy notice" />
        <label className="tick"><input type="checkbox" checked={d.messagesConsent} onChange={(e) => set('messagesConsent', e.target.checked)} /> Send me shift offers by text and WhatsApp. I can stop at any time by replying STOP.</label>
        <div className="f"><label className="l" htmlFor="sig">Type your full name to sign</label>
          <input id="sig" type="text" autoComplete="name" value={d.signature} onChange={(e) => set('signature', e.target.value)} placeholder={`${d.first} ${d.last}`} /></div>
        {err && <p className="err">{err}</p>}
        <button className="btn blue" style={{ minHeight: 54, fontSize: 17 }} disabled={pending} onClick={submit}>{pending ? stage || 'Sending…' : 'Submit my registration'}</button>
        {!d.messagesConsent && <p className="note" style={{ margin: 0 }}>Without this tick we can’t send you shift offers.</p>}
      </Section>
    </>
  );
}
