import { cn, initials } from "@/lib/utils";
import { POS_LABEL, type Pos } from "@/lib/fantasy/config";

const POS_CLASS: Record<Pos, string> = {
  GK: "text-pos-gk bg-pos-gk/12 ring-pos-gk/30",
  DEF: "text-pos-def bg-pos-def/12 ring-pos-def/30",
  MID: "text-pos-mid bg-pos-mid/12 ring-pos-mid/30",
  FWD: "text-pos-fwd bg-pos-fwd/12 ring-pos-fwd/30",
};

export function PosBadge({ pos, className }: { pos: Pos | string; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 min-w-9 items-center justify-center rounded-md px-1.5 text-[10px] font-bold tracking-wide ring-1 ring-inset", POS_CLASS[pos as Pos], className)}>
      {POS_LABEL[pos as Pos]}
    </span>
  );
}

export function PlayerAvatar({ name, photoUrl, pos, size = 36, className }: { name: string; photoUrl?: string | null; pos?: Pos | string; size?: number; className?: string }) {
  const ring = pos ? { GK: "ring-pos-gk/50", DEF: "ring-pos-def/50", MID: "ring-pos-mid/50", FWD: "ring-pos-fwd/50" }[pos as Pos] : "ring-line-strong";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-3 ring-2 text-silver", ring, className)} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="font-semibold">{initials(name)}</span>
      )}
    </span>
  );
}

export function ClubCrest({ name, logoUrl, code, size = 20 }: { name: string; logoUrl?: string | null; code?: string | null; size?: number }) {
  if (logoUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} title={name} width={size} height={size} className="shrink-0 object-contain" loading="lazy" />;
  return (
    <span title={name} className="inline-flex shrink-0 items-center justify-center rounded-md bg-surface-3 font-bold text-silver ring-1 ring-line-strong" style={{ width: size, height: size, fontSize: size * 0.36 }}>
      {(code ?? name).slice(0, 3).toUpperCase()}
    </span>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  INJURED: { label: "Lesionado", cls: "text-loss" },
  SUSPENDED: { label: "Suspenso", cls: "text-loss" },
  DOUBTFUL: { label: "Dúvida", cls: "text-warn" },
};

export function StatusDot({ status, note }: { status: string; note?: string | null }) {
  const s = STATUS[status];
  if (!s) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-semibold", s.cls)} title={note ?? s.label}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

export function TeamMark({ name, color = "#2F6BFF", size = 36 }: { name: string; color?: string; size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.34, background: `linear-gradient(135deg, ${color}, ${color}88)` }}>
      {initials(name)}
    </span>
  );
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="font-semibold text-silver">{title}</div>
      {body && <div className="mt-1 max-w-sm text-sm text-muted">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="eyebrow">{label}</div>
      <div className="num mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function DemoBanner({ className }: { className?: string }) {
  return (
    <div className={cn("demo-stripe rounded-xl border border-warn/30 px-3 py-2 text-xs font-medium text-warn", className)}>
      MODO DEMO — clubes, jogadores e estatísticas <b>fictícios e simulados</b>. Não representam dados reais.
    </div>
  );
}

/** Marca MIDWEEK: estrela geométrica original (não usa marcas da UEFA). */
export function Logo({ size = 28, withText = true }: { size?: number; withText?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7FB0FF" />
            <stop offset="1" stopColor="#2F6BFF" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="15" fill="none" stroke="url(#lg)" strokeWidth="1.5" />
        <path d="M16 5.5l2.6 7.9 8.3.1-6.7 4.9 2.5 7.9L16 21.4l-6.7 4.9 2.5-7.9-6.7-4.9 8.3-.1z" fill="url(#lg)" />
      </svg>
      {withText && (
        <span className="leading-none">
          <span className="block text-[15px] font-bold tracking-[0.18em]">MIDWEEK</span>
          <span className="block text-[9px] font-medium tracking-[0.2em] text-muted">FANTASY · CHAMPIONS</span>
        </span>
      )}
    </span>
  );
}
