import React, { useState } from 'react';

export const domainOf = (w) => { try { const u = new URL(/^https?:\/\//i.test(w) ? w : `https://${w}`); return u.hostname.replace(/^www\./, '') || null; } catch { return null; } };

/** Company logo from the account's website; falls back to `children` (initials) when there is none or it fails to load. */
export default function Logo({ website, size = 48, children, className = '' }) {
  const d = domainOf(website); const [bad, setBad] = useState(false);
  if (!d || bad) return children || null;
  return <img className={`logo ${className}`} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer"
    src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=128`} onError={() => setBad(true)} onLoad={(e) => { if (e.target.naturalWidth <= 16) setBad(true); }} />;
}
