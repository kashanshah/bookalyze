import Link from "next/link";
import { BrandPanel } from "@/components/auth/brand-panel";
import { Brand } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Link href="/" className="w-fit">
          <Brand className="h-8" />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="fade-in-0 slide-in-from-bottom-2 w-full max-w-[400px] animate-in duration-500">
            {children}
          </div>
        </div>
        <p className="text-muted-foreground text-xs">© {new Date().getFullYear()} Bookalyze</p>
      </div>
      <BrandPanel />
    </div>
  );
}
