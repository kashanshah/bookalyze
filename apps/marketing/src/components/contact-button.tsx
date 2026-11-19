"use client";

import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The floating "Questions?" button on every page of the site: opens the contact form, which
 * becomes a ticket on the support desk. Not shown on the contact page itself.
 */
export function ContactButton() {
  const pathname = usePathname();
  if (pathname.startsWith("/contact")) return null;
  return (
    <Link
      href="/contact"
      className="fade-in-0 fixed end-4 bottom-4 z-40 flex h-11 animate-in items-center gap-2 rounded-full bg-primary ps-3.5 pe-4 font-medium text-primary-foreground text-sm shadow-lg ring-1 ring-black/5 transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:end-6 sm:bottom-6 print:hidden"
    >
      <MessageCircle className="size-4.5" />
      Questions? Talk to us
    </Link>
  );
}
