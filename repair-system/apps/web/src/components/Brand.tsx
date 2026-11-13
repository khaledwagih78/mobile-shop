export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#0B1F3A" />
      <rect x="20" y="10" width="24" height="44" rx="5" fill="#1D6FE0" />
      <rect x="23" y="15" width="18" height="30" rx="2" fill="#D9F5FB" />
      <circle cx="32" cy="49" r="2.4" fill="#22C3E6" />
      <path d="M44 40l8 8-4 4-8-8z" fill="#22C3E6" />
    </svg>
  );
}

export function BrandTitle() {
  return (
    <div className="flex items-center gap-3">
      <Logo />
      <div className="leading-tight">
        <div className="text-lg font-bold">خالد لصيانة المحمول</div>
        <div className="text-xs text-slate-500">Khaled Mobile Repair</div>
      </div>
    </div>
  );
}
