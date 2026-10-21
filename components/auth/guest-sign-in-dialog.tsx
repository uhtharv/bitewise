"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import {
  GoogleMarkIcon,
  performGoogleOAuth,
} from "@/components/auth/custom-auth-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export type GuestSignInMode = "limit" | "save";

export interface GuestSignInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: GuestSignInMode;
  onContinueWithGoogle?: () => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
}

export interface GuestSignInDialogViewProps {
  mode: GuestSignInMode;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onContinueWithGoogle?: () => void;
  onCancel?: () => void;
}

export function GuestSignInDialogView({
  mode,
  isSubmitting = false,
  errorMessage = null,
  onContinueWithGoogle,
  onCancel,
}: GuestSignInDialogViewProps) {
  const title =
    mode === "limit"
      ? "Daily guest limit reached"
      : "Sign in to save your meal";

  const description =
    mode === "limit"
      ? "You've used all 3 free guest analyses for today. Sign in with Google to get 30 analyses per day and track your daily log."
      : "Sign in with Google to add this meal to your daily tracker, view totals, and set macro goals. Your analyzed meal is saved and ready to log when you return.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-black tracking-tight text-ink">
          {title}
        </h2>
        <p className="text-sm text-body">
          {description}
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-900"
        >
          {errorMessage}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-3">
        <Button
          type="button"
          size="lg"
          disabled={isSubmitting}
          onClick={onContinueWithGoogle}
          className="w-full gap-2 text-base font-semibold"
        >
          {isSubmitting ? (
            <Loader2Icon className="size-5 animate-spin" />
          ) : (
            <GoogleMarkIcon />
          )}
          <span>Continue with Google</span>
        </Button>

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-mute hover:text-ink"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export function GuestSignInDialog({
  open,
  onOpenChange,
  mode,
  onContinueWithGoogle,
  isSubmitting: externalIsSubmitting,
  errorMessage: externalErrorMessage,
}: GuestSignInDialogProps) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [internalSubmitting, setInternalSubmitting] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);

  const isSubmitting = externalIsSubmitting ?? internalSubmitting;
  const errorMessage = externalErrorMessage ?? internalError;

  async function handleGoogleClick() {
    if (onContinueWithGoogle) {
      onContinueWithGoogle();
      return;
    }

    setInternalSubmitting(true);
    setInternalError(null);

    const result = await performGoogleOAuth({
      mode: "sign-in",
      redirectUrl: "/",
      signIn,
      signUp,
    });

    if (result.errorMessage) {
      setInternalError(result.errorMessage);
      setInternalSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <GuestSignInDialogView
          mode={mode}
          isSubmitting={isSubmitting}
          errorMessage={errorMessage}
          onContinueWithGoogle={handleGoogleClick}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
