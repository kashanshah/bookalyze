"use client";

import { LogOut, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
] as const;

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex w-full items-center gap-2.5 rounded-xl p-2 text-start outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=open]:bg-foreground/[0.04]"
      >
        <Avatar name={name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm leading-tight">{name}</span>
          <span className="block truncate text-muted-foreground text-xs">{email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-64">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/account/security">
            <ShieldCheck />
            Account & security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <p className="mb-1.5 text-muted-foreground text-xs">Appearance</p>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTheme(t.value)}
                className={cn(
                  "flex items-center justify-center gap-1 rounded-md py-1 text-xs transition-all [&_svg]:size-3.5",
                  theme === t.value
                    ? "bg-card font-medium shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await authClient.signOut();
            router.push("/sign-in");
            router.refresh();
          }}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
