import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-xl border border-transparent bg-clip-padding text-base font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-on-primary hover:bg-primary-active active:bg-primary-neutral",
        outline:
          "border-ink bg-canvas text-ink hover:bg-canvas-soft aria-expanded:bg-canvas-soft",
        secondary:
          "bg-canvas-soft text-ink hover:bg-primary-pale aria-expanded:bg-canvas-soft",
        ghost: "text-ink hover:bg-canvas-soft aria-expanded:bg-canvas-soft",
        destructive:
          "bg-negative/10 text-negative hover:bg-negative/20 focus-visible:border-negative/40 focus-visible:ring-negative/20",
        link: "text-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-11 gap-2 px-6 py-3",
        xs: "min-h-9 gap-1 rounded-lg px-3 text-xs font-semibold",
        sm: "min-h-11 gap-1.5 rounded-xl px-4 text-sm font-semibold",
        lg: "min-h-12 gap-2 rounded-xl px-7 py-3.5 text-base font-semibold",
        icon: "size-11 rounded-full",
        "icon-xs": "size-9 rounded-full",
        "icon-sm": "size-11 rounded-full",
        "icon-lg": "size-12 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
