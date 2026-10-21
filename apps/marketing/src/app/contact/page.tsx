import { BookOpen, Mail } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Section, SectionHeading } from "@/components/section";
import { CONTACT_EMAIL } from "@/lib/site";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = {
  title: "Contact us",
  description:
    "Questions about Bookalyze, help with your account, or a marketplace or country we don't cover yet: write to us and a person replies.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <Section className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-start">
      <div className="fade-in-0 slide-in-from-bottom-3 grid animate-in gap-8 duration-700">
        <SectionHeading
          as="h1"
          align="start"
          eyebrow="Contact us"
          title="Talk to a person"
          lead="A question before you start, help with your account, or a marketplace you'd like us to connect: write to us and a person will reply."
        />
        <ul className="grid gap-4 text-sm">
          <li className="flex gap-3">
            <BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Looking for how something works? The{" "}
              <Link
                href="/guides"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                guides
              </Link>{" "}
              answer most questions straight away.
            </span>
          </li>
          <li className="flex gap-3">
            <Mail className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Prefer email? Write to{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </span>
          </li>
        </ul>
      </div>
      <div className="fade-in-0 slide-in-from-bottom-6 relative animate-in fill-mode-both delay-150 duration-700">
        <Suspense>
          <ContactForm />
        </Suspense>
      </div>
    </Section>
  );
}
