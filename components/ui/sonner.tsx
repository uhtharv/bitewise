"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-positive" />,
        info: <InfoIcon className="size-4 text-ink" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-deep" />,
        error: <OctagonXIcon className="size-4 text-negative" />,
        loading: <Loader2Icon className="size-4 animate-spin text-ink" />,
      }}
      style={
        {
          "--normal-bg": "var(--canvas)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast rounded-xl bg-canvas text-ink text-sm shadow-md",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
