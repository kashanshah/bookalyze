import Link from "next/link";
import { Brand } from "@/components/brand";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/">
            <Brand className="h-7" />
          </Link>
          <Link href="/" className="text-muted-foreground text-sm hover:text-foreground">
            Back to app
          </Link>
        </div>
      </header>
      <main className="fade-in-0 slide-in-from-bottom-1 mx-auto grid max-w-3xl animate-in gap-6 px-4 py-10 duration-300">
        {children}
      </main>
    </div>
  );
}
