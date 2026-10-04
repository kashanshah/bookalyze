"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({
  href,
  children,
  exact = false,
  className,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-all duration-150 [&_svg]:size-[17px] [&_svg]:shrink-0 [&_svg]:transition-colors",
        active
          ? "bg-card font-medium text-foreground shadow-xs ring-1 ring-border [&_svg]:text-primary"
          : "text-sidebar-foreground hover:bg-foreground/[0.04] hover:text-foreground [&_svg]:text-muted-foreground group-hover:[&_svg]:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}
