import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireSupportAgent } from "@/server/support";

export const metadata: Metadata = {
  title: { template: "%s · Support desk", default: "Support desk" },
};

/** The support desk, for platform admins only (everyone else gets a 404). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSupportAgent();
  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/admin/support" className="flex items-center gap-3">
            <Brand className="h-7" />
            <span className="hidden text-muted-foreground text-sm sm:inline">Support desk</span>
          </Link>
          <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
            Back to app
          </Link>
        </div>
      </header>
      <main className="fade-in-0 slide-in-from-bottom-1 mx-auto grid max-w-5xl animate-in gap-6 px-4 py-8 duration-300 sm:py-10">
        {children}
      </main>
    </div>
  );
}
