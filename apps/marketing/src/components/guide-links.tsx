import { ArrowRight, BookOpen } from "lucide-react";
import Link from "next/link";
import { guide } from "@/content/guides";
import { cn } from "@/lib/site";

/** Cards linking to guides by slug: title and summary. Slugs without a guide are left out. */
export function GuideLinks({ slugs, className }: { slugs: readonly string[]; className?: string }) {
  const guides = slugs.map(guide).filter((g) => g !== undefined);
  if (!guides.length) return null;
  return (
    <ul className={cn("grid gap-4 sm:grid-cols-2", className)}>
      {guides.map((g) => (
        <li
          key={g.slug}
          className="group relative grid content-start gap-2 rounded-2xl border bg-card p-5 shadow-xs transition-shadow hover:shadow-md"
        >
          <p className="flex items-center gap-2 font-semibold">
            <BookOpen className="size-4 shrink-0 text-primary" />
            <Link
              href={`/guides/${g.slug}`}
              className="after:absolute after:inset-0 after:rounded-2xl"
            >
              {g.title}
            </Link>
          </p>
          <p className="line-clamp-3 text-muted-foreground text-sm leading-6">{g.summary}</p>
          <span className="inline-flex items-center gap-1 font-medium text-primary text-sm">
            Read the guide
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5 rtl:rotate-180" />
          </span>
        </li>
      ))}
    </ul>
  );
}
