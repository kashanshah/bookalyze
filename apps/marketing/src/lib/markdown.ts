import type { Feature } from "../content/features";
import { FEATURES } from "../content/features";
import { type Block, CATEGORIES, GUIDES, type Guide, guide } from "../content/guides";
import { SITE_URL } from "./site";

/**
 * The guides and feature pages as Markdown, for AI assistants and anyone who'd rather read plain
 * text: /llms.txt (the index, llmstxt.org's format), /llms-full.txt (everything in one file), and
 * each guide or feature at its address with ".md". Made from the same content as the pages, so
 * they never drift apart.
 */

const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

function block(b: Block): string {
  if ("p" in b) return b.p;
  if ("where" in b) return `**Where in Bookalyze:** ${b.where}`;
  if ("steps" in b) {
    return b.steps.map((s, i) => `${i + 1}. **${s.title}.** ${s.body}`).join("\n");
  }
  if ("list" in b) return b.list.map((item) => `- ${item}`).join("\n");
  if ("check" in b) {
    return ["What you should see:", ...b.check.map((item) => `- [ ] ${item}`)].join("\n");
  }
  if ("note" in b) {
    const label = b.tone === "tip" ? "Tip" : b.tone === "caution" ? "Caution" : "Note";
    return `> **${label}:** ${b.note}`;
  }
  const { head, rows } = b.table;
  return [
    `| ${head.map(cell).join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

export const guideUrl = (slug: string, base = SITE_URL) => `${base}/guides/${slug}`;
export const featureUrl = (slug: string, base = SITE_URL) => `${base}/features/${slug}`;

export function guideMarkdown(g: Guide, base = SITE_URL): string {
  const category = CATEGORIES.find((c) => c.id === g.category);
  const related = (g.related ?? []).flatMap((slug) => {
    const r = guide(slug);
    return r ? [`- [${r.title}](${guideUrl(slug, base)}.md): ${r.summary}`] : [];
  });
  return [
    `# ${g.title}`,
    "",
    `> ${g.summary}`,
    "",
    `Category: ${category?.title ?? g.category} · Web page: ${guideUrl(g.slug, base)}`,
    "",
    ...g.sections.flatMap((s) => [
      `## ${s.heading}`,
      "",
      ...s.blocks.flatMap((b) => [block(b), ""]),
    ]),
    ...(related.length ? ["## Related guides", "", ...related, ""] : []),
  ].join("\n");
}

export function featureMarkdown(f: Feature, base = SITE_URL): string {
  return [
    `# ${f.name}`,
    "",
    `> ${f.tagline}`,
    "",
    `Web page: ${featureUrl(f.slug, base)}`,
    "",
    f.intro,
    "",
    ...f.sections.flatMap((s) => [
      `## ${s.title}`,
      "",
      s.body,
      "",
      ...s.points.map((p) => `- ${p}`),
      "",
    ]),
    "## How it works",
    "",
    ...f.steps.map((s, i) => `${i + 1}. **${s.title}.** ${s.body}`),
    "",
    "## Questions",
    "",
    ...f.faq.flatMap((q) => [`### ${q.q}`, "", q.a, ""]),
    "## Guides",
    "",
    ...f.guides.flatMap((slug) => {
      const g = guide(slug);
      return g ? [`- [${g.title}](${guideUrl(slug, base)}.md)`] : [];
    }),
    "",
  ].join("\n");
}

const ABOUT = [
  "# Bookalyze",
  "",
  "> Accounting and back office for marketplace sellers: Amazon, Walmart, Noon and eBay settlements in the books, payouts matched to bank deposits, stock and landed cost, cost of goods sold, channel profit and each product's profit after ads, review requests and buyer invoices, for several companies in several countries.",
  "",
  'These are Bookalyze\'s own guides and feature pages, in Markdown. They describe the app as it is: screens are named the way the app names them ("Commerce → Channel profit → By product"). Anything not built yet is said so. Numbers in examples are made up.',
  "",
];

/** /llms.txt: what Bookalyze is, and a link to every guide and feature in Markdown. */
export function llmsTxt(base = SITE_URL): string {
  return [
    ...ABOUT,
    `Everything in one file: ${base}/llms-full.txt`,
    "",
    ...CATEGORIES.flatMap((c) => {
      const guides = GUIDES.filter((g) => g.category === c.id);
      if (!guides.length) return [];
      return [
        `## ${c.title}`,
        "",
        ...guides.map((g) => `- [${g.title}](${guideUrl(g.slug, base)}.md): ${g.summary}`),
        "",
      ];
    }),
    "## Features",
    "",
    ...FEATURES.map((f) => `- [${f.name}](${featureUrl(f.slug, base)}.md): ${f.tagline}`),
    "",
    "## Optional",
    "",
    `- [Pricing](${base}/pricing): plans and what each includes`,
    `- [Help](${base}/help): contact and support`,
    "",
  ].join("\n");
}

/** /llms-full.txt: every guide and feature page, one after the other. */
export function llmsFullTxt(base = SITE_URL): string {
  return [
    ...ABOUT,
    ...GUIDES.flatMap((g) => [guideMarkdown(g, base), "---", ""]),
    ...FEATURES.flatMap((f) => [featureMarkdown(f, base), "---", ""]),
  ].join("\n");
}
