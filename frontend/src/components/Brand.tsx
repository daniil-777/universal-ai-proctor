export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand flex items-center gap-2.5 shrink-0">
      <div className="brand-mark h-9 w-9 grid place-items-center rounded-lg bg-primary text-primary-foreground">
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 18V7a2 2 0 0 1 2-2h5a4 4 0 0 1 0 8H5M12 18h5a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
          <path d="m15.5 10 3.5 3 3-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="miter" />
        </svg>
      </div>
      {!compact && (
        <div className="brand-copy min-w-0">
          <div className="font-semibold text-sm tracking-tight truncate">
            Process Guide
          </div>
          <div className="text-[10px] text-muted-foreground tracking-wide">
            Process guidance &amp; review
          </div>
        </div>
      )}
    </div>
  );
}
