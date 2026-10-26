/* eslint-disable @next/next/no-img-element */
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'logo sm' : 'logo'}>
      <img src="/logo.png" alt="Staff Selection UK" />
      <div className="wm">
        Staff Selection UK<span>ShiftReady</span>
      </div>
    </div>
  );
}
