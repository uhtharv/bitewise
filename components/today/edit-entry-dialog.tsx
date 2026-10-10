"use client";

import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MealEntryRow } from "@/lib/supabase/user";

export interface EditEntryDialogProps {
  entry: MealEntryRow | null;
  open: boolean;
  isSaving?: boolean;
  errorMessage?: string | null;
  onOpenChange: (open: boolean) => void;
  onSaveQuantity: (entryId: string, newQuantityG: number) => void;
}

export function EditEntryDialog({
  entry,
  open,
  isSaving = false,
  errorMessage = null,
  onOpenChange,
  onSaveQuantity,
}: EditEntryDialogProps) {
  const [rawQuantity, setRawQuantity] = useState<string>(() =>
    entry ? String(entry.quantity_g) : ""
  );

  const trimmed = rawQuantity.trim();
  const parsed = trimmed === "" ? Number.NaN : Number(trimmed);
  const isValidQuantity = Number.isFinite(parsed) && parsed > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entry || !isValidQuantity || isSaving) {
      return;
    }
    const rounded = Math.round(parsed * 100) / 100;
    onSaveQuantity(entry.id, rounded);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit quantity{entry ? ` — ${entry.food_name}` : ""}
          </DialogTitle>
          <DialogDescription>
            Enter the updated weight in grams. Calories and macros will rescale
            automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="edit-entry-quantity-input"
              className="text-sm font-semibold text-ink"
            >
              Quantity (grams)
            </label>
            <Input
              id="edit-entry-quantity-input"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              value={rawQuantity}
              disabled={isSaving}
              aria-invalid={!isValidQuantity}
              onChange={(e) => setRawQuantity(e.target.value)}
            />
            {!isValidQuantity && (
              <p role="alert" className="text-xs font-semibold text-negative">
                Quantity must be a positive number of grams.
              </p>
            )}
            {errorMessage && (
              <p role="alert" className="text-xs font-semibold text-negative">
                {errorMessage}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValidQuantity || isSaving}
            >
              {isSaving && <Loader2Icon className="size-4 animate-spin" />}
              <span>Save changes</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

