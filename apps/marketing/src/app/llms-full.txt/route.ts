import { llmsFullTxt } from "@/lib/markdown";

export const dynamic = "force-static";

/** Every guide and feature page in one Markdown file, for AI assistants. */
export function GET() {
  return new Response(llmsFullTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
