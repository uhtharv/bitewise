import * as React from "react";
import { cn } from "cn";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-md border border-ink bg-canvas px-4 py-3 text-base text-ink transition-colors outline-none placeholder:text-mute focus-visible:border-ink focus-visible:ring-3 focus-visible:ring-ink/25 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-negative aria-invalid:ring-3 aria-invalid:ring-negative/20",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
