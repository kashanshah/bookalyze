import { GUIDES, guide } from "@/content/guides";
import { guideMarkdown } from "@/lib/markdown";

// /guides/<slug>.md is rewritten here (next.config.ts).
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

/** A guide as Markdown, for AI assistants and plain-text readers. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const g = guide((await params).slug);
  if (!g) return new Response("Not found", { status: 404 });
  return new Response(guideMarkdown(g), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
