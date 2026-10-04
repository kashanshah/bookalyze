"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

/** Top bar with a slide-down navigation drawer on small screens. */
export function MobileNav({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer after navigation
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <div className="sticky top-0 z-40 lg:hidden">
      <div className="flex h-14 items-center justify-between border-b bg-background/85 px-4 backdrop-blur-md">
        <Link href="/" className="flex items-center" aria-label="Bookalyze home">
          <Brand className="h-6" />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open ? (
        <div className="fade-in-0 slide-in-from-top-2 fixed inset-x-0 top-14 bottom-0 animate-in overflow-y-auto bg-sidebar p-4 duration-200">
          {children}
        </div>
      ) : null}
    </div>
  );
}
