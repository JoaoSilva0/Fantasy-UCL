import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-accent text-white shadow-[0_8px_24px_-10px_rgb(47_107_255/0.8)] hover:bg-accent-strong",
        secondary: "bg-surface-2 text-fg border border-line-strong hover:bg-surface-3",
        ghost: "text-silver hover:text-fg hover:bg-white/5",
        danger: "bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25",
        success: "bg-win/15 text-win border border-win/30 hover:bg-win/25",
      },
      size: { sm: "h-8 px-3 text-xs", md: "h-10 px-4", lg: "h-12 px-6 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
