'use client';
import Link from 'next/link';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTemplate } from '../../actions';

export function Templates({ items }: { items: { id: string; name: string; detail: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!items.length) return <p className="note">None yet. Tick “Save as a regular shift” when you request one.</p>;
  return (
    <div className="tablewrap"><table>
      <tbody>{items.map((t) => (
        <tr key={t.id}>
          <td><b>{t.name}</b><br /><span className="note">{t.detail}</span></td>
          <td style={{ textAlign: 'right' }}><span className="btnrow" style={{ justifyContent: 'flex-end' }}>
            <Link className="btn blue small" href={`/portal/new?t=${t.id}`}>Use</Link>
            <button className="btn ghost small" disabled={pending} onClick={() => start(async () => { await deleteTemplate(t.id); router.refresh(); })}>Delete</button>
          </span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
