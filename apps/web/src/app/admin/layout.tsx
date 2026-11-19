import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireSupportAgent } from "@/server/support";

export const metadata: Metadata = {
  title: { template: "%s · Admin", default: "Admin" },
};

/** Overview, People, the support desk and Growth, for platform admins only (everyone else gets a 404). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSupportAgent();
  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 px-4 sm:h-14 sm:flex-nowrap">
          <Link href="/admin" className="flex h-12 items-center gap-3 sm:h-auto">
            <Brand className="h-7" />
          </Link>
          {/* Phones: the links get their own row, scrolling sideways if they don't fit. */}
          <nav
            className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-4 overflow-x-auto whitespace-nowrap border-t px-4 py-2.5 text-sm sm:mx-0 sm:w-auto sm:overflow-visible sm:border-0 sm:p-0"
            aria-label="Admin"
          >
            <Link href="/admin" className="text-muted-foreground hover:text-foreground">
              Overview
            </Link>
            <Link href="/admin/people" className="text-muted-foreground hover:text-foreground">
              People
            </Link>
            <Link href="/admin/support" className="text-muted-foreground hover:text-foreground">
              <span className="sm:hidden">Support</span>
              <span className="hidden sm:inline">Support desk</span>
            </Link>
            <Link href="/admin/growth" className="text-muted-foreground hover:text-foreground">
              Growth
            </Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              Back to app
            </Link>
          </nav>
        </div>
      </header>
      <main className="fade-in-0 slide-in-from-bottom-1 mx-auto grid max-w-5xl animate-in gap-6 px-4 py-8 duration-300 sm:py-10">
        {children}
      </main>
    </div>
  );
}
