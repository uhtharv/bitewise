import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppHeaderContent } from "@/components/layout/app-header";

let mockPathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

vi.mock("@clerk/nextjs", () => ({
  Show: ({
    when,
    children,
  }: {
    when: "signed-in" | "signed-out";
    children: React.ReactNode;
  }) => <div data-clerk-show={when}>{children}</div>,
  UserButton: () => <div data-testid="user-button">UserButton</div>,
}));

describe("AppHeader navigation styling", () => {
  it("renders the active tab as a hollow pill and inactive tabs with matching pill shape", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(<AppHeaderContent />);

    // Log meal is active
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/"');
    // Active tab is a hollow pill: rounded-full + border-ink + bg-transparent + text-ink
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*class="[^"]*rounded-full[^"]*border border-ink bg-transparent text-ink[^"]*"[^>]*href="\/"/
    );

    // Inactive tabs (Today, Settings) use rounded-full + border-transparent to prevent layout shifts
    expect(html).toMatch(
      /<a[^>]*class="[^"]*rounded-full[^"]*border border-transparent text-ink hover:bg-canvas-soft[^"]*"[^>]*href="\/today"/
    );
    expect(html).toMatch(
      /<a[^>]*class="[^"]*rounded-full[^"]*border border-transparent text-ink hover:bg-canvas-soft[^"]*"[^>]*href="\/settings"/
    );
  });

  it("updates the hollow pill indicator when navigating to /today", () => {
    mockPathname = "/today";
    const html = renderToStaticMarkup(<AppHeaderContent />);

    // Today is active
    expect(html).toContain('aria-current="page"');
    expect(html).toMatch(
      /<a[^>]*aria-current="page"[^>]*class="[^"]*rounded-full[^"]*border border-ink bg-transparent text-ink[^"]*"[^>]*href="\/today"/
    );

    // Log meal is inactive
    expect(html).toMatch(
      /<a[^>]*class="[^"]*rounded-full[^"]*border border-transparent text-ink hover:bg-canvas-soft[^"]*"[^>]*href="\/"/
    );
  });

  it("keeps the Sign-in button as a solid primary button, distinct from the hollow pill tab", () => {
    mockPathname = "/";
    const html = renderToStaticMarkup(<AppHeaderContent />);

    // Sign in button retains solid primary styling with rounded-xl
    expect(html).toMatch(
      /<a[^>]*class="[^"]*rounded-xl bg-primary[^"]*text-on-primary[^"]*"[^>]*href="\/sign-in"/
    );

    // Active tab and Sign in button have distinct styling (active is hollow pill rounded-full, signin is solid rounded-xl)
    const activeTabMatch = html.match(/<a[^>]*aria-current="page"[^>]*class="([^"]*)"/);
    const signInMatch = html.match(/<a[^>]*class="([^"]*)"[^>]*href="\/sign-in"/);

    expect(activeTabMatch).not.toBeNull();
    expect(signInMatch).not.toBeNull();

    const activeClasses = activeTabMatch![1];
    const signInClasses = signInMatch![1];

    expect(activeClasses).toContain("rounded-full");
    expect(activeClasses).toContain("border-ink");
    expect(activeClasses).toContain("bg-transparent");
    expect(activeClasses).not.toContain("bg-primary");

    expect(signInClasses).toContain("rounded-xl");
    expect(signInClasses).toContain("bg-primary");
    expect(signInClasses).not.toContain("rounded-full");
    expect(signInClasses).not.toContain("border-ink");
  });

  it("returns null when on /sign-in page", () => {
    mockPathname = "/sign-in";
    const html = renderToStaticMarkup(<AppHeaderContent />);
    expect(html).toBe("");
  });
});
