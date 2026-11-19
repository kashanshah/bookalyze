import { mcpUrl } from "@bookalyze/core";
import type { Metadata } from "next";
import { AssistantReminders } from "@/components/ai/assistant-reminders";
import { ConnectAssistants } from "@/components/ai/connect-assistants";
import { PageHeader } from "@/components/shell/page-header";
import {
  assistantListings,
  loadAssistantConnections,
  loadAssistantReminders,
} from "@/server/ai-assistants";
import { requestOrigin } from "@/server/oauth-request";
import { getOrgContext } from "@/server/org";

export const metadata: Metadata = { title: "AI assistants" };

/**
 * Connect ChatGPT, Claude, Gemini and coding assistants to Bookalyze. Connections belong to the
 * person, not the company (one sign-in covers every company they choose), so this page and
 * /account/ai-assistants show the same thing; here the examples name this company.
 */
export default async function AiAssistantsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getOrgContext(slug);
  const [origin, connections, { reminders }] = await Promise.all([
    requestOrigin(),
    loadAssistantConnections(ctx.session.user.id),
    loadAssistantReminders(ctx.session.user.id),
  ]);
  return (
    <div className="grid gap-8">
      <PageHeader
        title="AI assistants"
        description="Use Bookalyze from ChatGPT, Claude, Gemini and coding assistants. Each one signs in as you and only does what you allow."
      />
      <AssistantReminders reminders={reminders} />
      <ConnectAssistants
        origin={origin}
        mcpUrl={mcpUrl(origin)}
        connections={connections}
        listings={assistantListings()}
        companyName={ctx.org.name}
      />
    </div>
  );
}
