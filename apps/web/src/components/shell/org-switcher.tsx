"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

export function OrgSwitcher({
  current,
  orgs,
}: {
  current: { slug: string; name: string };
  orgs: { slug: string; name: string; role: string }[];
}) {
  const currentRole = orgs.find((o) => o.slug === current.slug)?.role;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch company"
        className="group flex w-full items-center gap-2.5 rounded-xl border bg-card p-2 text-start shadow-xs outline-none transition-all hover:border-primary/30 hover:shadow-sm focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=open]:border-primary/40"
      >
        <Avatar name={current.name} shape="square" className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm leading-tight">{current.name}</span>
          <span className="block text-muted-foreground text-xs">
            {ROLE[currentRole ?? ""] ?? "Company"}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-64"
      >
        <DropdownMenuLabel>Your companies</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem key={org.slug} asChild>
            <Link href={`/o/${org.slug}`}>
              <Avatar name={org.name} shape="square" className="size-6 text-[10px]" />
              <span className="flex-1 truncate">{org.name}</span>
              {org.slug === current.slug ? <Check className="text-primary!" /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <span className="flex size-6 items-center justify-center rounded-md border border-dashed">
              <Plus className="size-3.5" />
            </span>
            Add a company
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
