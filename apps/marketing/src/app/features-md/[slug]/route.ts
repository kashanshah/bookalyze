import { FEATURES, feature } from "@/content/features";
import { featureMarkdown } from "@/lib/markdown";

// /features/<slug>.md is rewritten here (next.config.ts).
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return FEATURES.map((f) => ({ slug: f.slug }));
}

/** A feature page as Markdown, for AI assistants and plain-text readers. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const f = feature((await params).slug);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(featureMarkdown(f), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
