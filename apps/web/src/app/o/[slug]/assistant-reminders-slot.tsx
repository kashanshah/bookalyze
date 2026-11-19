import { AssistantReminders } from "@/components/ai/assistant-reminders";
import { loadAssistantReminders } from "@/server/ai-assistants";

/** The dashboard's reconnect reminders (nothing when no assistant's access is ending). */
export async function AssistantRemindersSlot({
  userId,
  base,
  locale,
  timeZone,
}: {
  userId: string;
  base: string;
  locale?: string;
  timeZone?: string;
}) {
  const { reminders } = await loadAssistantReminders(userId, { locale, timeZone });
  if (!reminders.length) return null;
  return <AssistantReminders reminders={reminders} href={`${base}/settings/ai-assistants`} />;
}
