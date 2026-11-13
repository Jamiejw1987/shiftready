/** Postcode lookups via postcodes.io (free, open UK government data) and distance maths. */

export type Point = { lat: number; lng: number };

export function normalisePostcode(pc: string): string {
  const s = (pc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 3 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s;
}

export function looksLikePostcode(pc: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test((pc || '').trim());
}

/** Looks up many postcodes in one go (100 per request). Returns a map of normalised postcode to point. */
export async function geocodePostcodes(postcodes: string[]): Promise<Map<string, Point>> {
  const out = new Map<string, Point>();
  const unique = [...new Set(postcodes.map(normalisePostcode).filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      const res = await fetch('https://api.postcodes.io/postcodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postcodes: batch }),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const json = await res.json();
      for (const r of json.result ?? []) {
        if (r?.result) out.set(normalisePostcode(r.query), { lat: r.result.latitude, lng: r.result.longitude });
      }
    } catch {
      // Network problem: leave these postcodes without a location. They won't match radius searches until fixed.
    }
  }
  return out;
}

export async function geocodePostcode(pc: string): Promise<Point | null> {
  const m = await geocodePostcodes([pc]);
  return m.get(normalisePostcode(pc)) ?? null;
}

/** True for an outward code on its own, e.g. "BD4" or "LS10". */
export function looksLikeOutcode(pc: string): boolean {
  return /^[A-Z]{1,2}\d[A-Z\d]?$/i.test((pc || '').trim());
}

/** Centre point of a full postcode ("BD4 6SG") or just the area code ("BD4"). */
export async function geocodePlace(q: string): Promise<Point | null> {
  const v = (q || '').trim();
  if (looksLikePostcode(v)) return geocodePostcode(v);
  if (!looksLikeOutcode(v)) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(v.toUpperCase())}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const r = (await res.json()).result;
    return r?.latitude != null ? { lat: r.latitude, lng: r.longitude } : null;
  } catch {
    return null;
  }
}

/** Straight-line distance in miles. */
export function milesBetween(a: Point, b: Point): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
