'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClientMark } from '@/components/ClientMark';
import { setClientLogo } from './actions';

/** Pick an image; it's fitted into a 256px square (keeping see-through backgrounds) and saved. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const box = 256, scale = Math.min(box / img.width, box / img.height, 1);
    const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const webp = c.toDataURL('image/webp', 0.9);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

export function LogoUpload({ id, name, logo }: { id: string; name: string; logo: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (v: string | null) => start(async () => {
    const r = await setClientLogo(id, v);
    setMsg({ ok: r.ok, text: r.ok ? r.message ?? 'Saved.' : r.error ?? 'Something went wrong.' });
    if (r.ok) router.refresh();
  });
  return (
    <div className="phero">
      <ClientMark name={name} logo={logo} size={72} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="btnrow">
          <button className="btn ghost small" disabled={pending} onClick={() => input.current?.click()}>{logo ? 'Change logo' : 'Add logo'}</button>
          {logo && <button className="btn ghost small" disabled={pending} onClick={() => save(null)}>Remove</button>}
        </span>
        <span className="note">Shows in a circle at the top of their portal. A square logo on a plain background looks best.</span>
        {msg && <span className={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 10 * 1024 * 1024) return setMsg({ ok: false, text: 'That file is over 10MB. Try a smaller one.' });
        try { save(await shrink(f)); } catch { setMsg({ ok: false, text: 'Couldn’t read that image. Try a PNG or JPG.' }); }
      }} />
    </div>
  );
}
