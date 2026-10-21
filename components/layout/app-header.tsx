"use client";

import { Show, UserButton } from "@clerk/nextjs";
import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const NAV_ITEMS = [
  { href: "/", label: "Log meal" },
  { href: "/today", label: "Today" },
  { href: "/settings", label: "Settings" },
] as const;

export function AppHeaderContent() {
  const pathname = usePathname();

  if (pathname?.startsWith("/sign-in")) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-canvas px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-md px-2 text-xl font-black tracking-tight text-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25"
        >
          Bitewise
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Main navigation" className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname?.startsWith(`${item.href}/`);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center justify-center rounded-full px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25",
                    isActive
                      ? "border border-ink bg-transparent text-ink"
                      : "border border-transparent text-ink hover:bg-canvas-soft"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Show when="signed-in">
            <div className="ml-1 flex min-h-11 min-w-11 items-center justify-center">
              <UserButton />
            </div>
          </Show>

          <Show when="signed-out">
            <Link
              href="/sign-in"
              className="ml-1 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-on-primary transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ink/25"
            >
              Sign in
            </Link>
          </Show>
        </div>
      </div>
    </header>
  );
}

export function AppHeader() {
  return (
    <Suspense fallback={null}>
      <AppHeaderContent />
    </Suspense>
  );
}

