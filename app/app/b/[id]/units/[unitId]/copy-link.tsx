"use client";

import { useState } from "react";
import { Button, inputStyles } from "@/components/ui";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={url} dir="ltr" className={`${inputStyles} text-small`} onFocus={(e) => e.target.select()} />
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "کپی شد" : "کپی"}
      </Button>
    </div>
  );
}
