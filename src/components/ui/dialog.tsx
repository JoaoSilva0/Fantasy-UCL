"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/70 backdrop-blur-sm data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "card fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 focus:outline-none",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-lg font-semibold tracking-tight">{title}</D.Title>
            {description && <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>}
          </div>
          <D.Close className="rounded-lg p-1 text-muted hover:bg-white/5 hover:text-fg" aria-label="Fechar">
            <X size={18} />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
