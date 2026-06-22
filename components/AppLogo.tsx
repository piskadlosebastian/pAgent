import clsx from "clsx";

type AppLogoProps = {
  compact?: boolean;
  className?: string;
};

export function AppLogo({ compact = false, className }: AppLogoProps) {
  return (
    <div className={clsx("app-logo", compact && "app-logo-compact", className)} aria-label="pAgent">
      <svg className="app-logo-mark" viewBox="0 0 64 64" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="pagentLogoGradient" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#F3D6E4" />
            <stop offset="0.52" stopColor="#7C6FAF" />
            <stop offset="1" stopColor="#DFF3EE" />
          </linearGradient>
          <linearGradient id="pagentLogoSpark" x1="20" y1="18" x2="50" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#F3D6E4" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="22" fill="url(#pagentLogoGradient)" />
        <path
          d="M21 47V19h15.5C45 19 51 24.8 51 32.6S45 46 36.5 46H31v9"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M31 30.2h6.1c2.4 0 4.1 1.5 4.1 3.5s-1.7 3.5-4.1 3.5H31z" fill="rgba(255,255,255,0.92)" />
        <path d="M45.8 12.5l1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6z" fill="url(#pagentLogoSpark)" />
        <path
          d="M17 14.5c8.2-5.6 19.7-6.1 29.1-.3"
          fill="none"
          stroke="rgba(255,255,255,0.48)"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {!compact ? (
        <div className="app-logo-text">
          <span className="app-logo-name">pAgent</span>
        </div>
      ) : null}
    </div>
  );
}
