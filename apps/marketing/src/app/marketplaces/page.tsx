import type { Metadata } from "next";
import { CountryCards } from "@/components/countries";
import { ClosingCta } from "@/components/cta";
import { MarketplaceCards } from "@/components/marketplaces";
import { Section, SectionHeading } from "@/components/section";

export const metadata: Metadata = {
  title: "Marketplaces",
  description:
    "Amazon, Walmart, Noon and eBay, each connected to your books: orders, settlements posted, payouts matched to your bank, stock and profit per channel.",
  alternates: { canonical: "/marketplaces" },
};

export default function MarketplacesPage() {
  return (
    <>
      <Section className="grid gap-12">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Marketplaces"
            title="Amazon, Walmart, Noon and eBay, straight into your books"
            lead="Each connection brings in orders, fees, refunds and payouts every day, posts them as clean entries, and finds each payout in your bank."
          />
        </div>
        <MarketplaceCards />
      </Section>
      <Section tint className="grid gap-12">
        <SectionHeading
          eyebrow="Where we work"
          title="By country"
          lead="Where Amazon meets Walmart, and where Amazon meets Noon."
        />
        <CountryCards />
      </Section>
      <div className="pt-20 sm:pt-28">
        <ClosingCta />
      </div>
    </>
  );
}
