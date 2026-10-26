'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { displayMobile } from '@/lib/phone';
import { inviteConsultant, setAccess, updateMember, setPayroll } from './actions';

type Member = { id: string; full_name: string; email: string; role: 'admin' | 'consultant'; mobile: string | null; active: boolean; payroll?: boolean; temps: number; shifts: number };

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
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Consultant</th><th>Role</th><th>Accept alerts to</th><th>Temps added</th><th>Shifts sent</th><th>Access</th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} style={m.active ? undefined : { opacity: 0.6 }}>
              <td><b>{m.full_name}</b>{m.id === meId && <span className="note"> (you)</span>}<div className="note">{m.email}</div></td>
              {editing === m.id ? (
                <>
                  <td data-l="Role"><select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Member['role'] })}><option value="consultant">Consultant</option><option value="admin">Admin</option></select></td>
                  <td data-l="Mobile"><input type="tel" placeholder="07…" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></td>
                </>
              ) : (
                <>
                  <td data-l="Role"><span className={`pill ${m.role === 'admin' ? 'blue' : 'mute'}`}>{m.role === 'admin' ? 'Admin' : 'Consultant'}</span></td>
                  <td className="num" data-l="Alerts">{m.mobile ? displayMobile(m.mobile) : <span className="note">Not set</span>}</td>
                </>
              )}
              <td className="num" data-l="Temps added">{m.temps}</td>
              <td className="num" data-l="Shifts sent">{m.shifts}</td>
              <td>
                <div className="btnrow">
                  {editing === m.id ? (
                    <>
                      <button className="btn blue small" disabled={pending} onClick={() => run(() => updateMember(m.id, edit), () => setEditing(null))}>Save</button>
                      <button className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <button className="btn ghost small" onClick={() => { setEditing(m.id); setEdit({ role: m.role, mobile: m.mobile ? displayMobile(m.mobile) : '' }); }}>Edit</button>
                  )}
                  {m.id !== meId && (
                    <button className="btn ghost small" disabled={pending} onClick={() => run(() => setAccess(m.id, !m.active))}>{m.active ? 'Switch off access' : 'Restore access'}</button>
                  )}
                  <button className="btn ghost small" disabled={pending} onClick={() => run(() => setPayroll(m.id, !m.payroll))}>{m.payroll ? 'Remove payroll' : 'Make payroll contact'}</button>
                  {m.payroll && <span className="pill blue">Payroll</span>}
                  {!m.active && <span className="pill bad">Off</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="bar" style={{ display: 'block' }}>
        <h3>Invite a consultant</h3>
        <div className="form">
          <div className="f"><label className="l" htmlFor="iName">Full name</label><input id="iName" type="text" value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iEmail">Work email</label><input id="iEmail" type="email" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iMob">Mobile for alerts: shift accepted, registration finished (optional)</label><input id="iMob" type="tel" placeholder="07…" value={inv.mobile} onChange={(e) => setInv({ ...inv, mobile: e.target.value })} /></div>
          <div className="f"><label className="l" htmlFor="iRole">Role</label>
            <select id="iRole" value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Member['role'] })}><option value="consultant">Consultant</option><option value="admin">Admin</option></select></div>
        </div>
        <div className="btnrow" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn blue" disabled={pending} onClick={() => run(() => inviteConsultant(inv), () => setInv({ name: '', email: '', role: 'consultant', mobile: '' }))}>Send invite email</button>
        </div>
        <p className="note">They’ll get an email to set a password, then set up an authenticator app on first sign-in.</p>
      </div>
    </section>
  );
}
