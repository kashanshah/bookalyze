import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CallToAction, FallbackLink, Note, Paragraph, Title } from "./components/parts";
import { brand } from "./components/theme";

export type SupportMessageProps = {
  /** "T-0042". */
  ticket: string;
  subject: string;
  /** Who wrote the message, as the reader knows them. */
  authorName: string;
  /** The new message, plain text. */
  body: string;
  /** "new" for a new ticket (to the desk), "reply" for a reply. */
  kind: "new" | "reply";
  /** The desk's email shows the company and the requester. */
  context?: string | null;
  /** The ticket in the app; none for a website enquiry, answered by email only. */
  url?: string | null;
  /** Replying to the email adds to the ticket. */
  canReplyByEmail: boolean;
};

export function SupportMessage({
  ticket,
  subject,
  authorName,
  body,
  kind,
  context,
  url,
  canReplyByEmail,
}: SupportMessageProps) {
  const heading = kind === "new" ? `New ticket ${ticket}` : `${authorName} replied on ${ticket}`;
  return (
    <EmailLayout
      preview={`${heading}: ${subject}`}
      footerNote="You're receiving this because of a Bookalyze support ticket you're part of."
    >
      <Title>{heading}</Title>
      <Paragraph>
        <strong style={{ color: brand.ink }}>{subject}</strong>
        {context ? ` · ${context}` : null}
      </Paragraph>
      <Section
        style={{
          border: `1px solid ${brand.border}`,
          borderRadius: 12,
          padding: 16,
          margin: "8px 0 0",
        }}
      >
        <Text style={{ margin: "0 0 6px", fontSize: 13, lineHeight: "18px", color: brand.muted }}>
          {authorName}
        </Text>
        {body.split(/\n{2,}/).map((para, i) => (
          <Text
            // Paragraphs of a plain-text message, in order.
            // biome-ignore lint/suspicious/noArrayIndexKey: static text, never reordered
            key={i}
            style={{
              margin: i ? "10px 0 0" : 0,
              fontSize: 15,
              lineHeight: "22px",
              color: brand.ink,
              whiteSpace: "pre-wrap",
            }}
          >
            {para}
          </Text>
        ))}
      </Section>
      {url ? (
        <>
          <CallToAction href={url}>Open the ticket</CallToAction>
          <FallbackLink href={url} />
        </>
      ) : null}
      {canReplyByEmail ? (
        <Note>Reply to this email to answer. Your reply is added to the ticket.</Note>
      ) : null}
    </EmailLayout>
  );
}

SupportMessage.PreviewProps = {
  ticket: "T-0042",
  subject: "My Amazon.ae payout doesn't match the deposit",
  authorName: "Bookalyze support",
  body: "The payout was in dirhams and the deposit in Canadian dollars, so the amounts differ.\n\nOpen the settlement and choose Match at this rate; the difference posts as an exchange loss.",
  kind: "reply",
  context: null,
  url: "https://app.bookalyze.com/help/preview",
  canReplyByEmail: true,
} satisfies SupportMessageProps;

export default SupportMessage;
