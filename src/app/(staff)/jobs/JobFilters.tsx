'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export function JobFilters({ show, q, counts, toFill }: { show: string; q: string; counts: Record<'open' | 'filled' | 'closed' | 'all', number>; toFill: number }) {
  const router = useRouter();
  const [text, setText] = useState(q);
  const go = (s: string, t = text) => router.replace(`/jobs?show=${s}${t.trim() ? `&q=${encodeURIComponent(t.trim())}` : ''}`);
  useEffect(() => { const id = setTimeout(() => { if (text !== q) go(show, text); }, 300); return () => clearTimeout(id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [text]);
  const tab = (s: keyof typeof counts, label: string) => (
    <button className={`btn small ${show === s ? 'blue' : 'ghost'}`} aria-pressed={show === s} onClick={() => go(s)}>{label} ({counts[s]})</button>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
      <div className="btnrow">{tab('open', 'Open')}{tab('filled', 'Filled')}{tab('closed', 'Closed')}{tab('all', 'All')}</div>
      <span className="note"><b>{toFill}</b> {toFill === 1 ? 'person' : 'people'} still needed across open jobs</span>
      <input type="search" placeholder="Search client, role or site" value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 280 }} aria-label="Search jobs" />
    </div>
  );
}
