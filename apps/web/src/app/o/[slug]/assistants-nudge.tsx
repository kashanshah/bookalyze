import { examplePrompts } from "@bookalyze/core";
import { ArrowRight, Asterisk, MessagesSquare, Sparkles } from "lucide-react";
import Link from "next/link";
import { loadAssistantConnections } from "@/server/ai-assistants";

/**
 * On the home page until the person connects an assistant: Bookalyze works inside ChatGPT,
 * Claude and Gemini. Gone once one is connected (it's per person, so each member sees their own).
 */
export async function AssistantsNudge({
  userId,
  base,
  company,
}: {
  userId: string;
  base: string;
  company: string;
}) {
  const connections = await loadAssistantConnections(userId);
  if (connections.length) return null;
  const [ask] = examplePrompts(company);
  return (
    <section className="fade-in-0 relative animate-in overflow-hidden rounded-2xl border bg-card shadow-xs duration-500">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -start-20 -bottom-24 size-56 rounded-full bg-primary/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <div className="flex -space-x-2 rtl:space-x-reverse" aria-hidden="true">
          {[MessagesSquare, Asterisk, Sparkles].map((Icon, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of three marks
              key={i}
              className="flex size-10 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-primary"
            >
              <Icon className="size-4.5" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="font-semibold">Ask ChatGPT, Claude or Gemini about your books</h2>
          <p className="text-muted-foreground text-sm">
            Connect your assistant in a minute, then ask things like “{ask}”
          </p>
        </div>
        <Link
          href={`${base}/settings/ai-assistants`}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm shadow-xs transition-colors hover:bg-primary/92"
        >
          Connect an assistant
          <ArrowRight className="size-4 rtl:rotate-180" />
        </Link>
      </div>
    </section>
  );
}
