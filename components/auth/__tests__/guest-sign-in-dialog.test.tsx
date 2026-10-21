import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuestSignInDialogView } from "../guest-sign-in-dialog";

describe("GuestSignInDialogView", () => {
  it("renders limit mode with locked copy and Google button", () => {
    const html = renderToStaticMarkup(
      <GuestSignInDialogView
        mode="limit"
      />
    );

    expect(html).toContain("Daily guest limit reached");
    expect(html).toContain("You&#x27;ve used all 3 free guest analyses for today");
    expect(html).toContain("Continue with Google");
  });

  it("renders save mode with locked copy and Google button", () => {
    const html = renderToStaticMarkup(
      <GuestSignInDialogView
        mode="save"
      />
    );

    expect(html).toContain("Sign in to save your meal");
    expect(html).toContain("Sign in with Google to add this meal to your daily tracker");
    expect(html).toContain("Continue with Google");
  });

  it("renders error message in alert banner when provided", () => {
    const html = renderToStaticMarkup(
      <GuestSignInDialogView
        mode="limit"
        errorMessage="OAuth failed. Please try again."
      />
    );

    expect(html).toContain("OAuth failed. Please try again.");
    expect(html).toContain('role="alert"');
  });

  it("renders cancel button when onCancel handler is passed", () => {
    const html = renderToStaticMarkup(
      <GuestSignInDialogView
        mode="save"
        onCancel={() => {}}
      />
    );

    expect(html).toContain("Cancel");
  });
});

