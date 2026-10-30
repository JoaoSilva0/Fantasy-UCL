"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Gavel, Home, Radio, Repeat, Settings2, Shirt, ShoppingBag, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export function LeagueNav({ leagueId, isCommissioner, drafting }: { leagueId: string; isCommissioner: boolean; drafting: boolean }) {
  const path = usePathname();
  const base = `/leagues/${leagueId}`;
  const items = [
    { href: base, label: "Início", icon: Home, exact: true },
    { href: `${base}/draft`, label: "Draft", icon: Gavel, dot: drafting },
    { href: `${base}/team`, label: "Plantel", icon: Shirt },
    { href: `${base}/market`, label: "Mercado", icon: ShoppingBag },
    { href: `${base}/trades`, label: "Trades", icon: Repeat },
    { href: `${base}/live`, label: "Ao vivo", icon: Radio },
    { href: `${base}/calendar`, label: "Calendário", icon: CalendarDays },
    { href: `${base}/standings`, label: "Classificações", icon: Trophy },
    ...(isCommissioner ? [{ href: `${base}/admin`, label: "Admin", icon: Settings2 }] : []),
  ];
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Navegação da liga">
      {items.map((it) => {
        const active = it.exact ? path === it.href : path.startsWith(it.href);
        return (
          <Link key={it.href} href={it.href}
            className={cn("relative flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition", active ? "bg-accent-soft text-fg ring-1 ring-inset ring-accent/40" : "text-muted hover:bg-white/4 hover:text-fg")}>
            <it.icon size={16} className={active ? "text-glow" : ""} />
            {it.label}
            {"dot" in it && it.dot && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-loss" />}
          </Link>
        );
      })}
    </nav>
  );
}
