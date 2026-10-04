import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { referenceOptions } from "@/lib/reference-options";
import { listUserOrgs } from "@/server/org";
import { requireSession } from "@/server/session";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Set up your company" };

export default async function OnboardingPage() {
  const session = await requireSession("/onboarding");
  const orgs = await listUserOrgs(session.user.id);
  const firstName = session.user.name.split(" ")[0];
  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Brand className="h-7" />
          {orgs.length ? (
            <Link
              href="/"
              className="text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              Cancel
            </Link>
          ) : null}
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-10 lg:py-14">
        <div className="fade-in-0 slide-in-from-bottom-2 animate-in duration-500">
          <h1 className="font-semibold text-3xl tracking-tight">
            {orgs.length ? "Add another company" : `Welcome to Bookalyze, ${firstName}`}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Let's set up {orgs.length ? "its" : "your first company's"} books. It takes about a
            minute, and each company keeps its own books, settings and team.
          </p>
        </div>
        <div className="fade-in-0 animate-in fill-mode-both delay-100 duration-500">
          <OnboardingForm {...referenceOptions()} />
        </div>
      </main>
    </div>
  );
}
