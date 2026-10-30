import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-white/6 text-silver ring-1 ring-inset ring-line-strong",
      accent: "bg-accent-soft text-glow ring-1 ring-inset ring-accent/40",
      win: "bg-win/12 text-win ring-1 ring-inset ring-win/30",
      loss: "bg-loss/12 text-loss ring-1 ring-inset ring-loss/30",
      warn: "bg-warn/12 text-warn ring-1 ring-inset ring-warn/30",
      live: "bg-loss text-white",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...p} />;
}
