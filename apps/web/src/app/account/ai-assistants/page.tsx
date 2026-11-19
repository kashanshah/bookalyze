import { mcpUrl } from "@bookalyze/core";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { AssistantReminders } from "@/components/ai/assistant-reminders";
import { ConnectAssistants } from "@/components/ai/connect-assistants";
import { loadAssistantConnections, loadAssistantReminders } from "@/server/ai-assistants";
import { requestOrigin } from "@/server/oauth-request";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "AI assistants" };

/** The same as each company's Settings → AI assistants, outside any one company. */
export default async function AccountAiAssistantsPage() {
  const session = await requireSession("/account/ai-assistants");
  const [origin, connections, { reminders }] = await Promise.all([
    requestOrigin(),
    loadAssistantConnections(session.user.id),
    loadAssistantReminders(session.user.id),
  ]);
  return (
    <>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </span>
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">AI assistants</h1>
          <p className="mt-1 max-w-xl text-muted-foreground text-sm">
            Use Bookalyze from ChatGPT, Claude, Gemini and coding assistants. Each one signs in as
            you and only does what you allow.
          </p>
        </div>
      </div>
      <AssistantReminders reminders={reminders} />
      <ConnectAssistants origin={origin} mcpUrl={mcpUrl(origin)} connections={connections} />
    </>
  );
}
