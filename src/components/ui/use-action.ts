"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";

type Result = { ok: true; data?: unknown } | { ok: false; error: string };

/** Executa uma server action com estado pendente, toast de erro/sucesso e refresh dos dados. */
export function useAction() {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const run = (fn: () => Promise<Result>, opts: { success?: string; onSuccess?: (data: unknown) => void; refresh?: boolean } = {}) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast({ tone: "error", title: r.error });
      else {
        if (opts.success) toast({ tone: "success", title: opts.success });
        opts.onSuccess?.(r.data);
        if (opts.refresh !== false) router.refresh();
      }
    });
  return { pending, run };
}
