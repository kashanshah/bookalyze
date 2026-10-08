"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Inside a company the sidebar stays, so the rest of the app is one click away. */
export default function CompanyError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen {...props} compact />;
}
