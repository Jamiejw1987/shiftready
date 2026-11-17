'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { SignaturePad } from '@/components/SignaturePad';
import { saveFootwear, saveMark, finish } from './actions';

export type FlowDoc = { id: string; title: string; signMode: 'document' | 'every_page'; hasForm: boolean; pages: { url: string; w: number; h: number }[] };
type Step =
  | { kind: 'intro' }
  | { kind: 'details'; docId: string }
  | { kind: 'page'; doc: FlowDoc; d: number; page: number }
  | { kind: 'sign'; doc: FlowDoc; d: number }
  | { kind: 'finish' };

export function Flow({ token, first, name, packName, details, footwear: initialFootwear, docs, done: initialDone }: {
  token: string; first: string; name: string; packName: string;
  details: { site: string; scope: string; start: string; arrival: string };
  footwear: boolean | null; docs: FlowDoc[]; done: { docId: string; page: number; ok: boolean; signed: boolean }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState('');
  const [footwear, setFootwear] = useState<boolean | null>(initialFootwear);
  const [done, setDone] = useState(() => {
    const s = new Set<string>();
    for (const m of initialDone) {
      const d = docs.find((x) => x.id === m.docId);
      if (d && m.ok && (m.page === 0 || d.signMode !== 'every_page' || m.signed)) s.add(`${m.docId}:${m.page}`);
    }
    return s;
  });

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [{ kind: 'intro' }];
    docs.forEach((doc, d) => {
      if (doc.hasForm) out.push({ kind: 'details', docId: doc.id });
      doc.pages.forEach((_, k) => out.push({ kind: 'page', doc, d, page: k + 1 }));
      if (doc.signMode === 'document') out.push({ kind: 'sign', doc, d });
    });
    out.push({ kind: 'finish' });
    return out;
  }, [docs]);
  const isDone = (s: Step) =>
    s.kind === 'intro' ? done.size > 0 || footwear != null
      : s.kind === 'details' ? footwear != null
        : s.kind === 'page' ? done.has(`${s.doc.id}:${s.page}`)
          : s.kind === 'sign' ? done.has(`${s.doc.id}:0`) : false;
  const [at, setAt] = useState(() => { const i = steps.findIndex((s) => !isDone(s)); return i < 0 ? steps.length - 1 : i; });
  const step = steps[at];
  const work = steps.filter((s) => s.kind === 'page' || s.kind === 'sign');
  const workDone = work.filter(isDone).length;
  const totalPages = docs.reduce((n, d) => n + d.pages.length, 0);

  // Per-step inputs, reset whenever the step changes.
  const [read, setRead] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [sig, setSig] = useState<string | null>(null);
  const go = (n: number) => { setAt(n); setRead(false); setUnderstood(false); setSig(null); setErr(''); window.scrollTo({ top: 0 }); };
  const next = () => go(Math.min(steps.length - 1, at + 1));

  const save = (docId: string, page: number, s: string | null) => start(async () => {
    const r = await saveMark(token, { docId, page, read, understood, signature: s });
    if (!r.ok) { setErr(r.error ?? 'Couldn’t save.'); return; }
    setDone((x) => new Set(x).add(`${docId}:${page}`));
    next();
  });

  const bar = <div className="ind-bar" aria-label={`${workDone} of ${work.length} done`}><span style={{ width: `${work.length ? (100 * workDone) / work.length : 0}%` }} /></div>;
  const nav = (primary: React.ReactNode) => (
    <div className="ind-nav">
      <button className="btn ghost" disabled={at === 0 || pending} onClick={() => go(at - 1)}>Back</button>
      {primary}
    </div>
  );

  if (step.kind === 'intro') return (
    <>
      <section className="card"><div className="in">
        <h1 style={{ margin: 0 }}>{packName}</h1>
        <p style={{ margin: 0 }}>Hi {first}. Before your first shift you need to read the client’s safety briefings and safe working methods, and sign to say you’ve read and understood them.</p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>{docs.length} documents, {totalPages} pages. Allow about 30 minutes.</li>
          <li>On every page, tick that you’ve <b>read</b> it and that you <b>understand</b> it.</li>
          <li>Sign with your finger where asked. You can’t skip ahead.</li>
          <li>Pinch to zoom, or tap a page to open it full size.</li>
          <li>It saves as you go: you can stop and carry on later from the same link.</li>
        </ul>
        <p className="note" style={{ margin: 0 }}>If anything isn’t clear, call the office before you sign. On your first day someone will show you around site and you’ll sign one last sheet on paper.</p>
        {bar}
      </div></section>
      {nav(<button className="btn blue" onClick={next}>{done.size ? 'Carry on' : 'Start'}</button>)}
    </>
  );

  if (step.kind === 'details') return (
    <>
      <section className="card"><div className="in">
        <h2 className="sech" style={{ margin: 0 }}>Your induction form</h2>
        <p className="note" style={{ margin: 0 }}>These details are printed on the client’s induction form. If anything is wrong, call the office.</p>
        <dl className="kv">
          <dt>Name</dt><dd>{name}</dd>
          <dt>Site</dt><dd>{details.site || '-'}</dd>
          <dt>Scope of work</dt><dd>{details.scope || '-'}</dd>
          <dt>Start date</dt><dd>{details.start || '-'}</dd>
          <dt>Arrival time</dt><dd>{details.arrival || '-'}</dd>
        </dl>
        <b>Do you have appropriate safety footwear (safety boots)?</b>
        <div className="yn">
          <label className="tick"><input type="radio" name="fw" checked={footwear === true} onChange={() => setFootwear(true)} /> Yes</label>
          <label className="tick"><input type="radio" name="fw" checked={footwear === false} onChange={() => setFootwear(false)} /> No</label>
        </div>
        {footwear === false && <p className="alert">You’re not allowed to work on site without safety footwear. Please tell the office so we can sort your boots before your first shift. You can carry on with the induction.</p>}
        {err && <p className="err">{err}</p>}
      </div></section>
      {nav(<button className="btn blue" disabled={footwear == null || pending} onClick={() => start(async () => {
        const r = await saveFootwear(token, footwear!);
        if (!r.ok) { setErr(r.error ?? 'Couldn’t save.'); return; }
        next();
      })}>Next</button>)}
    </>
  );

  if (step.kind === 'page') {
    const p = step.doc.pages[step.page - 1];
    const already = done.has(`${step.doc.id}:${step.page}`);
    const needSig = step.doc.signMode === 'every_page';
    const ready = read && understood && (!needSig || !!sig);
    return (
      <>
        <div className="ind-head">
          <span className="note">Document {step.d + 1} of {docs.length} · page {step.page} of {step.doc.pages.length}</span>
          <span className="doc">{step.doc.title}</span>
          {bar}
        </div>
        <a href={p.url} target="_blank" rel="noopener noreferrer" aria-label="Open this page full size">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ind-page" src={p.url} alt={`${step.doc.title}, page ${step.page}`} width={p.w} height={p.h} style={{ aspectRatio: `${p.w} / ${p.h}` }} />
        </a>
        <a className="note" href={p.url} target="_blank" rel="noopener noreferrer" style={{ alignSelf: 'flex-start' }}>Open page full size</a>
        {already ? <p className="okmsg">✓ You’ve confirmed this page.</p> : (
          <section className="card"><div className="in">
            <label className="tick"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} /> I have read this page</label>
            <label className="tick"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} /> I understand this page</label>
            {needSig && <SignaturePad key={`${step.doc.id}:${step.page}`} resetKey={`${step.doc.id}:${step.page}`} label="Initial or sign this page" height={140} onChange={setSig} />}
            {err && <p className="err">{err}</p>}
          </div></section>
        )}
        {nav(already
          ? <button className="btn blue" onClick={next}>Next</button>
          : <button className="btn blue" disabled={!ready || pending} onClick={() => save(step.doc.id, step.page, needSig ? sig : null)}>{pending ? 'Saving…' : 'Confirm and continue'}</button>)}
      </>
    );
  }

  if (step.kind === 'sign') {
    const already = done.has(`${step.doc.id}:0`);
    return (
      <>
        <div className="ind-head">
          <span className="note">Document {step.d + 1} of {docs.length} · signature</span>
          <span className="doc">{step.doc.title}</span>
          {bar}
        </div>
        <section className="card"><div className="in">
          <p style={{ margin: 0 }}><b>I, {name}, confirm I have read and understood all {step.doc.pages.length} page{step.doc.pages.length === 1 ? '' : 's'} of “{step.doc.title}”, and I will follow it at all times.</b></p>
          {already ? <p className="okmsg">✓ Signed.</p> : <SignaturePad key={step.doc.id} resetKey={step.doc.id} onChange={setSig} />}
          {err && <p className="err">{err}</p>}
        </div></section>
        {nav(already
          ? <button className="btn blue" onClick={next}>Next</button>
          : <button className="btn blue" disabled={!sig || pending} onClick={() => { setRead(true); setUnderstood(true); start(async () => {
            const r = await saveMark(token, { docId: step.doc.id, page: 0, read: true, understood: true, signature: sig });
            if (!r.ok) { setErr(r.error ?? 'Couldn’t save.'); return; }
            setDone((x) => new Set(x).add(`${step.doc.id}:0`));
            next();
          }); }}>{pending ? 'Saving…' : 'Sign and continue'}</button>)}
      </>
    );
  }

  const left = work.length - workDone;
  return (
    <>
      <section className="card"><div className="in">
        <h2 className="sech" style={{ margin: 0 }}>{left ? 'Nearly there' : 'All pages done'}</h2>
        {bar}
        {left ? <p className="alert">{left} page{left === 1 ? '' : 's'} or signature{left === 1 ? '' : 's'} still to do. Go back and finish them.</p>
          : <p style={{ margin: 0 }}>You’ve read, understood and signed all {totalPages} pages of the {packName}. Press submit to send it to Staff Selection.</p>}
        {err && <p className="err">{err}</p>}
      </div></section>
      {nav(left
        ? <button className="btn blue" onClick={() => go(Math.max(0, steps.findIndex((s) => !isDone(s))))}>Go to the next page to do</button>
        : <button className="btn blue" disabled={pending} onClick={() => start(async () => {
          const r = await finish(token);
          if (!r.ok) { setErr(r.error ?? 'Couldn’t submit.'); return; }
          router.refresh();
        })}>{pending ? 'Submitting…' : 'Submit my induction'}</button>)}
    </>
  );
}
