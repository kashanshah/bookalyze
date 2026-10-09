"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/error-screen";

/** When even the root layout fails: the same screen, in a page of its own. */
export default function GlobalError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground antialiased">
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
