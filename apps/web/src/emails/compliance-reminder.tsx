import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CallToAction, Note, Paragraph, Title } from "./components/parts";
import { brand } from "./components/theme";

export type ComplianceReminderProps = {
  organizationName: string;
  items: { title: string; due: string; when: string; hint?: string }[];
  url: string;
};

/** A digest of compliance deadlines coming up for one company. */
export function ComplianceReminder({ organizationName, items, url }: ComplianceReminderProps) {
  const first = items[0];
  return (
    <EmailLayout
      preview={
        items.length === 1 && first
          ? `${first.title}: due ${first.when}.`
          : `${items.length} deadlines coming up for ${organizationName}.`
      }
      footerNote={`You're receiving this because you're an owner or admin of ${organizationName.replace(/\.$/, "")} in Bookalyze. Tick an item as done on the compliance calendar and it won't be mentioned again.`}
    >
      <Title>
        {items.length === 1 ? "A deadline is coming up" : `${items.length} deadlines are coming up`}
      </Title>
      <Paragraph>
        For <strong style={{ color: brand.ink }}>{organizationName}</strong>:
      </Paragraph>
      {items.map((item) => (
        <Section
          key={`${item.title}${item.due}`}
          style={{
            border: `1px solid ${brand.border}`,
            borderRadius: 12,
            padding: "12px 16px",
            margin: "8px 0 0",
          }}
        >
          <Text style={{ margin: 0, fontSize: 15, fontWeight: 600, color: brand.ink }}>
            {item.title}
          </Text>
          <Text style={{ margin: "4px 0 0", fontSize: 14, color: brand.muted }}>
            Due {item.due} ({item.when})
          </Text>
          {item.hint ? (
            <Text style={{ margin: "4px 0 0", fontSize: 13, color: brand.muted }}>{item.hint}</Text>
          ) : null}
        </Section>
      ))}
      <CallToAction href={url}>Open the compliance calendar</CallToAction>
      <Note>These dates follow the usual rules. Check special cases with your accountant.</Note>
    </EmailLayout>
  );
}

ComplianceReminder.PreviewProps = {
  organizationName: "Teknoffice Technologies",
  items: [
    {
      title: "File the annual return",
      due: "May 14, 2027",
      when: "in 7 days",
      hint: "With the Ontario Business Registry, within 60 days after the anniversary of incorporation.",
    },
    {
      title: "File the Canada Revenue Agency (GST/HST) return",
      due: "April 30, 2027",
      when: "tomorrow",
    },
  ],
  url: "http://localhost:3000/o/teknoffice/company/calendar",
} satisfies ComplianceReminderProps;
