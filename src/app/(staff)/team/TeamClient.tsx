'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { displayMobile } from '@/lib/phone';
import { inviteConsultant, setAccess, updateMember, setPayroll, setClientSms, sendLoginLink } from './actions';

type Member = { id: string; full_name: string; email: string; role: 'admin' | 'consultant'; mobile: string | null; active: boolean; payroll?: boolean; client_sms_alerts?: boolean; temps: number; shifts: number };

export function TeamClient({ members, meId }: { members: Member[]; meId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [inv, setInv] = useState({ name: '', email: '', role: 'consultant' as 'admin' | 'consultant', mobile: '' });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ role: 'consultant' as 'admin' | 'consultant', mobile: '' });

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error! });
      if (r.ok) { after?.(); router.refresh(); }
    });
  }

  return (
    <section className="panel">
      <h1>Team</h1>
      <p className="lede">Each consultant has their own login, protected by an authenticator app. Every temp added and shift sent is recorded against their name.</p>
      {msg && <p className={msg.ok ? 'okmsg' : 'err'} style={{ marginBottom: 10 }}>{msg.text}</p>}
      <div className="members">
        {members.map((m) => (
          <article key={m.id} className={`member${m.active ? '' : ' off'}`}>
            <div className="member-head">
              <div className="member-name">
                <b>{m.full_name}</b>{m.id === meId && <span className="note"> (you)</span>}
                <div className="note member-email">{m.email}</div>
              </div>
              <div className="member-tags">
                <span className={`pill ${m.role === 'admin' ? 'blue' : 'mute'}`}>{m.role === 'admin' ? 'Admin' : 'Consultant'}</span>
                {m.payroll && <span className="pill blue">Payroll</span>}
                {!m.active && <span className="pill bad">Off</span>}
              </div>
            </div>

            {editing === m.id ? (
              <div className="member-edit">
                <div className="f"><label className="l" htmlFor={`role-${m.id}`}>Role</label>
                  <select id={`role-${m.id}`} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Member['role'] })}><option value="consultant">Consultant</option><option value="admin">Admin</option></select></div>
                <div className="f"><label className="l" htmlFor={`mob-${m.id}`}>Mobile for alerts</label>
                  <input id={`mob-${m.id}`} type="tel" placeholder="07…" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></div>
              </div>
            ) : (
              <dl className="member-stats">
                <div><dt>Alerts to</dt><dd>{m.mobile ? displayMobile(m.mobile) : <span className="note">Not set</span>}</dd></div>
                <div><dt>Temps added</dt><dd>{m.temps}</dd></div>
                <div><dt>Shifts sent</dt><dd>{m.shifts}</dd></div>
              </dl>
            )}

            <div className="btnrow member-actions">
              {editing === m.id ? (
                <>
                  <button className="btn blue small" disabled={pending} onClick={() => run(() => updateMember(m.id, edit), () => setEditing(null))}>Save</button>
                  <button className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="btn ghost small" onClick={() => { setEditing(m.id); setEdit({ role: m.role, mobile: m.mobile ? displayMobile(m.mobile) : '' }); }}>Edit</button>
                  {m.active && <button className="btn ghost small" disabled={pending} onClick={() => run(() => sendLoginLink(m.id))}>Send password link</button>}
                  <button className="btn ghost small" disabled={pending} onClick={() => run(() => setPayroll(m.id, !m.payroll))}>{m.payroll ? 'Remove payroll' : 'Make payroll contact'}</button>
                  <button className="btn ghost small" disabled={pending} onClick={() => run(() => setClientSms(m.id, m.client_sms_alerts === false))}>{m.client_sms_alerts === false ? 'Turn on request texts' : 'Turn off request texts'}</button>
                  {m.id !== meId && (
                    <button className="btn ghost small danger" disabled={pending} onClick={() => run(() => setAccess(m.id, !m.active))}>{m.active ? 'Switch off access' : 'Restore access'}</button>
                  )}
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="bar" style={{ display: 'block' }}>
        <h3>Invite a consultant</h3>
        <div className="form">
          <div className="f"><label className="l" htmlFor="iName">Full name</label><input id="iName" type="text" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iEmail">Work email</label><input id="iEmail" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iMob">Mobile for alerts: client requests, shift accepted, registration finished</label><input id="iMob" type="tel" placeholder="07…" value={inv.mobile} onChange={(e) => setInv({ ...inv, mobile: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iRole">Role</label>
            <select id="iRole" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Member['role'] })}><option value="consultant">Consultant</option><option value="admin">Admin</option></select></div>
        </div>
        <div className="btnrow" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn blue" disabled={pending} onClick={() => run(() => inviteConsultant(inv), () => setInv({ name: '', email: '', role: 'consultant', mobile: '' }))}>Send invite email</button>
        </div>
        <p className="note">They’ll get an email to set a password, then set up an authenticator app on first sign-in. If it doesn’t arrive or has expired, use Send password link on their card.</p>
      </div>
    </section>
  );
}
