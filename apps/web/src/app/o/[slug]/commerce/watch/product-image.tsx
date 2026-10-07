"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** Amazon's product photo, with a quiet stand-in when it can't be shown. */
export function ProductImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        className={cn(
          "flex items-center justify-center rounded-xl bg-muted text-muted-foreground",
          className,
        )}
      >
        <ImageOff className="size-5" />
      </span>
    );
  }
  return (
    // Amazon hosts these photos on many domains, so they aren't routed through next/image.
    // biome-ignore lint/performance/noImgElement: Amazon image hosts aren't a fixed allowlist
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      className={cn("rounded-xl bg-muted object-contain", className)}
    />
  );
}
