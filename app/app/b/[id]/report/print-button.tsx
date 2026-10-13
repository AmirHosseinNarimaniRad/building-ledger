"use client";

import { Button } from "@/components/ui";

/** The browser's own print → "Save as PDF" shapes Persian text correctly; PDF libraries don't. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      چاپ / ذخیره PDF
    </Button>
  );
}
