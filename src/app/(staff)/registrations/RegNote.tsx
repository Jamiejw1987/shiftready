'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setRegNote } from './actions';

/** The note on someone's registration link (who they're for), with who sent it. Tap to change it. */
export function RegNote({ id, note, by }: { id: string; note: string | null; by?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(note ?? '');
  const [err, setErr] = useState('');
  if (editing) return (
    <span className="regnote-edit">
      <input type="text" maxLength={200} value={val} autoFocus onChange={(e) => setVal(e.target.value)} placeholder="e.g. Coventry tonight, Jamie"
        onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }} />
      <button className="btn blue small" disabled={pending} onClick={() => start(async () => {
        const r = await setRegNote(id, val);
        if (!r.ok) setErr(r.error ?? 'Couldn’t save.'); else { setEditing(false); setErr(''); router.refresh(); }
      })}>{pending ? 'Saving…' : 'Save'}</button>
      <button className="btn ghost small" disabled={pending} onClick={() => { setVal(note ?? ''); setEditing(false); }}>Cancel</button>
      {err && <span className="err">{err}</span>}
    </span>
  );
  return (
    <button type="button" className={`regnote${note ? '' : ' empty'}`} onClick={() => setEditing(true)} title="Change the note">
      {note ? <>📝 {note}</> : '+ Add a note'}{by && by !== '-' ? <span className="note"> · sent by {by}</span> : null}
    </button>
  );
}
