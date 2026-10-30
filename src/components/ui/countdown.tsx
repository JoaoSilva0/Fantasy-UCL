"use client";
import { useEffect, useState } from "react";

export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

export function Countdown({ to, className }: { to: string | Date; className?: string }) {
  const now = useNow(1000);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4), s = Math.floor((ms % 6e4) / 1e3);
  const pad = (n: number) => String(n).padStart(2, "0");
  return <span className={className} suppressHydrationWarning>{d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m` : `${pad(h)}:${pad(m)}:${pad(s)}`}</span>;
}
