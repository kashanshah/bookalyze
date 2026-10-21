import type { Metadata } from "next";
import { CountryCards } from "@/components/countries";
import { ClosingCta } from "@/components/cta";
import { Section, SectionHeading } from "@/components/section";

export const metadata: Metadata = {
  title: "Sellers by country",
  description:
    "Accounting for Amazon, Walmart and Noon sellers in the United States, Canada, Mexico, the UAE, Saudi Arabia and Egypt.",
  alternates: { canonical: "/sellers" },
};

export default function SellersPage() {
  return (
    <>
      <Section className="grid gap-12">
        <div className="fade-in-0 slide-in-from-bottom-3 animate-in duration-700">
          <SectionHeading
            as="h1"
            eyebrow="Sellers by country"
            title="Built for where Amazon, Walmart and Noon sell"
            lead="Where Amazon meets Walmart: the United States, Canada and Mexico. Where Amazon meets Noon: the UAE, Saudi Arabia and Egypt. Each country's marketplaces, currency and tax in one set of books."
          />
        </div>
        <CountryCards />
      </Section>
      <div className="pt-4 sm:pt-8">
        <ClosingCta />
      </div>
    </>
  );
}
