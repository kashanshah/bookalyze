import { llmsTxt } from "@/lib/markdown";

// Built once at build time, like the rest of the site.
export const dynamic = "force-static";

/** The guides and features for AI assistants (llmstxt.org): an index of Markdown pages. */
export function GET() {
  return new Response(llmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
