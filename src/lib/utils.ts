import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fmtPts = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) < 10 ? 2 : 1).replace(/\.?0+$/, "");

const TZ = "Europe/Lisbon";
export const fmtDate = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short", timeZone: TZ }).format(new Date(d));
export const fmtDateTime = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-PT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d));
export const fmtTime = (d: Date | string) =>
  new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(d));

export function timeAgo(d: Date | string) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
