export function fmtDate(d: string) {
  if (!d) return '';
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}

export const hhmm = (t: string) => (t || '').slice(0, 5);

export function shiftWhen(s: { shift_date: string; start_time: string; end_time: string }) {
  return `${fmtDate(s.shift_date)} ${hhmm(s.start_time)}-${hhmm(s.end_time)}`;
}

export function shiftHours(s: { start_time: string; end_time: string }) {
  const m = (t: string) => {
    const [h, mm] = t.split(':').map(Number);
    return h * 60 + mm;
  };
  let d = m(s.end_time) - m(s.start_time);
  if (d <= 0) d += 1440;
  return d / 60;
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
}

export const JOB_TYPES = ['Warehouse', 'FLT counterbalance', 'Production', 'Cleaning'] as const;
export const PPE_OPTIONS = ['Safety boots', 'Hi-vis vest', 'Thermal layers', 'Gloves'] as const;
