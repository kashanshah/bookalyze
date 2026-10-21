import { MessageCircleQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ButtonLink } from "@/components/button";
import { anchor, GuideBlock } from "@/components/guide-blocks";
import { GuideLinks } from "@/components/guide-links";
import { Section } from "@/components/section";
import { CATEGORIES, GUIDES, guide } from "@/content/guides";
import { SIGN_UP_URL } from "@/lib/site";

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const g = guide((await params).slug);
  if (!g) return {};
  return {
    title: g.title,
    description: g.summary,
    alternates: {
      canonical: `/guides/${g.slug}`,
      types: { "text/markdown": `/guides/${g.slug}.md` },
    },
    openGraph: { type: "article", title: g.title, description: g.summary },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = guide((await params).slug);
  if (!g) notFound();
  const category = CATEGORIES.find((c) => c.id === g.category);

  return (
    <Section className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
      <article className="grid min-w-0 gap-10">
        <header className="fade-in-0 slide-in-from-bottom-3 grid animate-in gap-4 duration-700">
          <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
            <Link href="/guides" className="hover:text-foreground">
              Guides
            </Link>
            {category ? (
              <>
                <span aria-hidden="true" className="mx-2">
                  /
                </span>
                <Link href={`/guides#${category.id}`} className="hover:text-foreground">
                  {category.title}
                </Link>
              </>
            ) : null}
          </nav>
          <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">
            {g.title}
          </h1>
          <p className="max-w-2xl text-pretty text-lg text-muted-foreground leading-relaxed">
            {g.summary}
          </p>
        </header>

        {g.sections.map((section) => (
          <section
            key={section.heading}
            id={anchor(section.heading)}
            aria-labelledby={`${anchor(section.heading)}-title`}
            className="grid scroll-mt-24 gap-5"
          >
            <h2
              id={`${anchor(section.heading)}-title`}
              className="font-semibold text-xl tracking-tight sm:text-2xl"
            >
              {section.heading}
            </h2>
            {section.blocks.map((block, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a guide's blocks never move
              <GuideBlock key={i} block={block} />
            ))}
          </section>
        ))}

        {g.related?.length ? (
          <section aria-labelledby="related-title" className="grid gap-5 border-t pt-10">
            <h2 id="related-title" className="font-semibold text-xl tracking-tight">
              Read next
            </h2>
            <GuideLinks slugs={g.related} />
          </section>
        ) : null}

        <aside className="grid gap-4 rounded-2xl border bg-sidebar p-6 sm:flex sm:items-center sm:justify-between">
          <p className="flex items-start gap-3">
            <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              <span className="block font-medium">Was this helpful?</span>
              <span className="text-muted-foreground text-sm">
                If something's missing or doesn't match what you see, tell us.
              </span>
            </span>
          </p>
          <ButtonLink href="/contact?topic=help" variant="outline">
            Contact us
          </ButtonLink>
        </aside>
      </article>

      <aside className="hidden lg:sticky lg:top-24 lg:grid lg:gap-6">
        <nav aria-label="On this page" className="grid gap-2 text-sm">
          <p className="font-medium">On this page</p>
          <ul className="grid gap-1.5 border-s ps-4 text-muted-foreground">
            {g.sections.map((s) => (
              <li key={s.heading}>
                <a href={`#${anchor(s.heading)}`} className="hover:text-foreground">
                  {s.heading}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid gap-3 rounded-2xl border bg-card p-5 shadow-xs">
          <p className="font-medium text-sm">Try it yourself</p>
          <p className="text-muted-foreground text-sm leading-6">30 days free. Cancel any time.</p>
          <ButtonLink href={SIGN_UP_URL} size="sm">
            Start free
          </ButtonLink>
        </div>
      </aside>
    </Section>
  );
}
