"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, LogOut, Settings } from "lucide-react";
import { Logo } from "@/components/ui/misc";
import { cn, initials, timeAgo } from "@/lib/utils";
import { logout, markNotificationsRead } from "@/server/actions/auth";

interface N { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }

export function TopBar({ user, notifications }: { user: { displayName: string; avatarColor: string; email: string }; notifications: N[] }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<"bell" | "user" | null>(null);
  const unread = notifications.filter((n) => !n.readAt).length;
  const toggle = (k: "bell" | "user") => {
    setOpen((o) => (o === k ? null : k));
    if (k === "bell" && unread) markNotificationsRead().then(() => router.refresh());
  };
  const nav = [{ href: "/dashboard", label: "Painel" }, { href: "/leagues", label: "Ligas" }];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/dashboard"><Logo size={26} /></Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", path === n.href || (n.href === "/leagues" && path.startsWith("/leagues")) ? "bg-white/6 text-fg" : "text-muted hover:text-fg")}>{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button onClick={() => toggle("bell")} className="relative rounded-xl p-2.5 text-silver hover:bg-white/5" aria-label="Notificações">
              <Bell size={19} />
              {unread > 0 && <span className="num absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            <AnimatePresence>
              {open === "bell" && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="card absolute right-0 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden">
                  <div className="eyebrow border-b border-line px-4 py-3">Notificações</div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted">Sem notificações.</div>}
                    {notifications.map((n) => (
                      <Link key={n.id} href={n.href ?? "#"} onClick={() => setOpen(null)} className="flex gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-white/3">
                        <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{n.title}</span>
                          {n.body && <span className="block text-xs text-muted">{n.body}</span>}
                          <span className="block text-[11px] text-faint" suppressHydrationWarning>{timeAgo(n.createdAt)}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="relative">
            <button onClick={() => toggle("user")} className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-white/5" aria-label="Conta">
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: user.avatarColor }}>{initials(user.displayName)}</span>
            </button>
            <AnimatePresence>
              {open === "user" && (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="card absolute right-0 mt-2 w-56 overflow-hidden p-1.5">
                  <div className="px-3 py-2"><div className="truncate text-sm font-semibold">{user.displayName}</div><div className="truncate text-xs text-muted">{user.email}</div></div>
                  <Link href="/settings" onClick={() => setOpen(null)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-silver hover:bg-white/5"><Settings size={16} /> Definições</Link>
                  <button onClick={async () => { await logout(); router.replace("/"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-silver hover:bg-white/5"><LogOut size={16} /> Sair</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <nav className="flex gap-1 border-t border-line px-4 py-1.5 sm:hidden">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={cn("rounded-lg px-3 py-1 text-sm font-medium", path.startsWith(n.href) ? "bg-white/6 text-fg" : "text-muted")}>{n.label}</Link>
        ))}
      </nav>
    </header>
  );
}
