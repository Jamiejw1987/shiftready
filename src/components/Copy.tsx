'use client';
import { useState } from 'react';

/** Copies text to the clipboard. Shows "Copied" for a moment so you know it worked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / blocked clipboard: fall back to a hidden textarea.
    try {
      const el = document.createElement('textarea');
      el.value = text; el.setAttribute('readonly', ''); el.style.position = 'fixed'; el.style.opacity = '0';
      document.body.appendChild(el); el.select(); const ok = document.execCommand('copy'); el.remove();
      return ok;
    } catch { return false; }
  }
}

export function CopyButton({ text, label = 'Copy', className = 'btn ghost small copybtn' }: { text: string | (() => Promise<string | null>); label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle');
  async function go() {
    setState('busy');
    const value = typeof text === 'string' ? text : await text();
    if (value == null) return setState('idle');
    const ok = await copyText(value);
    setState(ok ? 'done' : 'fail');
    setTimeout(() => setState('idle'), 1600);
  }
  return (
    <button type="button" className={className} disabled={state === 'busy'} onClick={go} aria-live="polite">
      {state === 'done' ? 'Copied ✓' : state === 'fail' ? 'Couldn’t copy' : state === 'busy' ? 'Copying…' : label}
    </button>
  );
}
