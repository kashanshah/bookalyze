"use client";

import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSignOut } from "@/components/shell/user-menu";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

/** The signed-in account in the onboarding header, so a wrong account can sign out before setting up. */
export function OnboardingAccountMenu({ name, email }: { name: string; email: string }) {
  const signOut = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-1 pe-2 text-start outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=open]:bg-foreground/[0.04]"
      >
        <Avatar name={name} className="size-7" />
        <span className="hidden max-w-56 truncate text-muted-foreground text-sm sm:block">
          {email}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="grid gap-0.5">
          <span className="truncate text-foreground text-sm">{name}</span>
          <span className="truncate font-normal">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/security">
            <ShieldCheck />
            Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={signOut}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "Not you?" under the welcome, for someone who signed in with the wrong Google account. */
export function WrongAccountHint({ email }: { email: string }) {
  const signOut = useSignOut();
  const [pending, setPending] = useState(false);
  return (
    <p className="mt-3 text-muted-foreground text-sm">
      Signed in as <span className="font-medium text-foreground">{email}</span>. Already have books
      here under another email?{" "}
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          await signOut();
        }}
        className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline disabled:opacity-60"
      >
        {pending ? <Spinner className="size-3.5" /> : null}
        Sign out and use that account
      </button>
    </p>
  );
}
