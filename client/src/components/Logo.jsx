/** Brand mark: a meter dial with a bolt. Same drawing as public/favicon.svg. */
export function LogoMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-g)" />
      <path d="M8.6 21.6a8 8 0 1 1 14.8 0" fill="none" stroke="#fff" strokeOpacity=".42" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M17.3 10.8 12.9 17.4h3l-.9 4.8 4.4-6.7h-3z" fill="#fff" />
    </svg>
  );
}

export function Logo() {
  return (
    <a className="brand" href="#map" aria-label="Urja Meter Explorer home">
      <LogoMark />
      <span className="brand-text">
        <strong>Urja</strong>
        <small>Meter Explorer</small>
      </span>
    </a>
  );
}
