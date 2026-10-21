import { signupTrialDays, suggestedSelection } from "@bookalyze/core";
import { CalendarCheck, CreditCard, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlanPicker } from "@/app/o/[slug]/settings/billing/plan-picker";
import { Brand } from "@/components/brand";
import { getOrgContext } from "@/server/org";
import { WaitForStripe } from "./wait-for-stripe";

export const metadata: Metadata = { title: "Choose your plan" };

/**
 * The last step of setting up a company: choose a plan and give a card in Stripe Checkout. The
 * company opens once Stripe confirms; an owner's first company is free for 30 days.
 */
export default async function StartPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const ctx = await getOrgContext(slug);
  if (ctx.billing.entitlement.mode !== "needs_card") redirect(`/o/${slug}`);
  const owner = ctx.role === "owner";
  const days = signupTrialDays(ctx.billing.state.account, ctx.billing.state.subscription);
  const locale = ctx.profile?.locale ?? "en-CA";
  const day = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" });
  const chargeOn = day.format(new Date(Date.now() + days * 86_400_000));
  // The last free day, as Plan and billing shows it.
  const lastFreeDay = day.format(new Date(Date.now() + (days - 1) * 86_400_000));
  const points = days
    ? [
        {
          icon: CalendarCheck,
          title: `${days} days free`,
          body: `Everything is included until ${lastFreeDay}, whichever plan you choose.`,
        },
        {
          icon: CreditCard,
          title: `First charge on ${chargeOn}`,
          body: "Then every month or year, for the plan you have on that day.",
        },
        {
          icon: Undo2,
          title: "Cancel any time",
          body: `In Plan and billing. Cancel before ${chargeOn} and nothing is charged.`,
        },
      ]
    : [
        {
          icon: CreditCard,
          title: "Charged today",
          body: "Your free 30 days were for your first company; this one starts on its plan.",
        },
        {
          icon: Undo2,
          title: "Cancel any time",
          body: "In Plan and billing; the plan stops at the end of the period you've paid for.",
        },
      ];

  return (
    <div className="min-h-dvh bg-sidebar">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-6">
          <Brand className="h-7" />
          <Link
            href="/"
            className="text-muted-foreground text-sm transition-colors hover:text-foreground"
          >
            Your companies
          </Link>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-10 sm:px-6 lg:py-14">
        <div className="fade-in-0 slide-in-from-bottom-2 animate-in duration-500">
          <p className="font-medium text-primary text-sm">Last step</p>
          <h1 className="mt-1 font-semibold text-3xl tracking-tight">
            Choose a plan for {ctx.org.name}
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {days
              ? `Try everything free for ${days} days. Stripe keeps your card safe; we never see it.`
              : "Stripe keeps your card safe; we never see it. People, orders and marketplaces are unlimited."}
          </p>
        </div>

        {checkout === "done" ? <WaitForStripe /> : null}
        {checkout === "cancelled" ? (
          <p className="rounded-xl border bg-card px-4 py-3 text-sm">
            Nothing was charged. Choose a plan when you're ready; the company opens after that.
          </p>
        ) : null}

        <ul
          className={`fade-in-0 grid animate-in gap-3 fill-mode-both delay-75 duration-500 ${days ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
        >
          {points.map((p) => (
            <li key={p.title} className="flex items-start gap-3 rounded-2xl border bg-card p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <p.icon className="size-4.5" />
              </span>
              <span className="grid gap-0.5">
                <span className="font-medium text-sm">{p.title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>

        <section className="fade-in-0 grid animate-in gap-4 rounded-2xl border bg-card fill-mode-both p-5 shadow-xs delay-150 duration-500 sm:p-6">
          {owner ? (
            <PlanPicker
              slug={slug}
              suggested={suggestedSelection(ctx.enabledModules)}
              canBuy
              cta={days ? `Start ${days} days free` : "Continue to payment"}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              {ctx.org.name} opens once its owner has chosen a plan. Ask them to sign in and finish
              setting it up.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
