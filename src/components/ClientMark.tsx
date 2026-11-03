/* eslint-disable @next/next/no-img-element */
/** A client's logo in a circle, or their initials if no logo has been added. */
export function ClientMark({ name, logo, size = 44 }: { name: string; logo: string | null | undefined; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="cmark" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {logo ? <img src={logo} alt={`${name} logo`} /> : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}

/** Portal header brand: the client first, with Staff Selection UK in the small print. */
export function ClientBrand({ name, logo }: { name: string; logo: string | null | undefined }) {
  return (
    <div className="cbrand">
      <ClientMark name={name} logo={logo} />
      <div className="cbrand-t">
        <b>{name}</b>
        <span>ShiftReady · Staff Selection UK</span>
      </div>
    </div>
  );
}
