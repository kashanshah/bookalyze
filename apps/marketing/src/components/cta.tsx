import { ArrowRight } from "lucide-react";
import { SIGN_UP_URL } from "@/lib/site";
import { BrandMark } from "./brand";
import { ButtonLink } from "./button";

/** The closing call to action on every page. */
export function ClosingCta({
  title = "Connect your first marketplace today",
  lead = "Try everything free for 30 days. Set up a company, connect a marketplace, and see your payouts in your books.",
}: {
  title?: string;
  lead?: string;
}) {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-28">
      <div className="relative mx-auto grid max-w-6xl justify-items-center gap-5 overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground sm:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute start-1/2 -top-24 size-[36rem] -translate-x-1/2 rounded-full bg-primary-foreground/10 blur-3xl rtl:translate-x-1/2"
        />
        <BrandMark className="relative h-9" />
        <h2 className="relative max-w-xl text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
          {title}
        </h2>
        <p className="relative max-w-lg text-pretty text-primary-foreground/80">{lead}</p>
        <ButtonLink href={SIGN_UP_URL} variant="inverse" size="lg" className="relative mt-2">
          Start free
          <ArrowRight className="rtl:rotate-180" />
        </ButtonLink>
      </div>
    </section>
  );
}
