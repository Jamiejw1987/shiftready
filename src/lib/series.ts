import { hhmm } from './format';

type Day = { shift_date: string; start_time: string; end_time: string };
const d = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'Europe/London' });

/** "Mon 2 Nov" */
export const dayLabel = (iso: string) => d(iso, { weekday: 'short', day: 'numeric', month: 'short' });
/** "Mon 2" */
export const dayShort = (iso: string) => d(iso, { weekday: 'short', day: 'numeric' });

/** e.g. "Mon 2 - Fri 6 Nov, 06:00-14:00" or "Mon 2, Wed 4, Fri 6 Nov, 06:00-14:00" */
export function seriesWhen(days: Day[]) {
  const sorted = [...days].sort((a, b) => a.shift_date.localeCompare(b.shift_date));
  if (!sorted.length) return '';
  const time = `${hhmm(sorted[0].start_time)}-${hhmm(sorted[0].end_time)}`;
  const month = d(sorted[sorted.length - 1].shift_date, { month: 'short' });
  const consecutive = sorted.every((x, i) => i === 0 || Date.parse(x.shift_date) - Date.parse(sorted[i - 1].shift_date) === 864e5);
  const crossMonth = month !== d(sorted[0].shift_date, { month: 'short' });
  if (crossMonth) {
    const span = consecutive && sorted.length > 2 ? `${dayLabel(sorted[0].shift_date)} - ${dayLabel(sorted[sorted.length - 1].shift_date)}` : sorted.map((x) => dayLabel(x.shift_date)).join(', ');
    return `${span}, ${time}`;
  }
  const span = sorted.length === 1 ? dayLabel(sorted[0].shift_date)
    : consecutive && sorted.length > 2 ? `${dayShort(sorted[0].shift_date)} - ${dayShort(sorted[sorted.length - 1].shift_date)} ${month}`
    : `${sorted.map((x) => dayShort(x.shift_date)).join(', ')} ${month}`;
  return `${span}, ${time}`;
}
