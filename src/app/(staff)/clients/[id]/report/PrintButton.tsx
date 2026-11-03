'use client';
export function PrintButton() {
  return <button className="btn blue small" onClick={() => window.print()}>Print / Save as PDF</button>;
}
