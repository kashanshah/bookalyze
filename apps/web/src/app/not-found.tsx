import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand className="h-9" />
      <div>
        <h1 className="font-semibold text-xl">Page not found</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          It doesn't exist, or you don't have access to it.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href="/">Go to Bookalyze</Link>
      </Button>
    </div>
  );
}
