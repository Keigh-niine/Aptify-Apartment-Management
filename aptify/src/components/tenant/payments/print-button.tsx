"use client";

import { Button } from "@/components/ui/button";

// Opens the browser's print window. "Save as PDF" is one of its options.
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      Download PDF
    </Button>
  );
}
