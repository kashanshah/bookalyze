import { Link, Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CallToAction, Note, Paragraph, Title } from "./components/parts";
import { brand } from "./components/theme";

export type ListingChangesProps = {
  organizationName: string;
  url: string;
  items: { title: string; channelName: string; summary: string; href: string }[];
};

/** One email when watched products change. */
export function ListingChanges({ organizationName, url, items }: ListingChangesProps) {
  const first = items[0];
  return (
    <EmailLayout
      preview={
        items.length === 1 && first
          ? `${first.title}: ${first.summary}`
          : `${items.length} products changed for ${organizationName}.`
      }
      footerNote={`You're receiving this because you're an owner or admin of ${organizationName.replace(/\.$/, "")} in Bookalyze, and listing watch has email turned on. Pause a product, or turn email off, and it won't be mentioned again.`}
    >
      <Title>
        {items.length === 1
          ? "A product you're watching changed"
          : `${items.length} products changed`}
      </Title>
      <Paragraph>
        For <strong style={{ color: brand.ink }}>{organizationName}</strong>:
      </Paragraph>
      {items.map((item) => (
        <Section
          key={item.href}
          style={{
            border: `1px solid ${brand.border}`,
            borderRadius: 12,
            padding: "12px 16px",
            margin: "8px 0 0",
          }}
        >
          <Text style={{ margin: 0, fontSize: 15, fontWeight: 600, color: brand.ink }}>
            <Link href={item.href} style={{ color: brand.ink, textDecoration: "none" }}>
              {item.title}
            </Link>
          </Text>
          <Text style={{ margin: "4px 0 0", fontSize: 13, color: brand.muted }}>
            {item.channelName}
          </Text>
          <Text style={{ margin: "6px 0 0", fontSize: 14, lineHeight: "22px", color: brand.text }}>
            {item.summary}
          </Text>
        </Section>
      ))}
      <CallToAction href={url}>See what changed</CallToAction>
      <Note>
        Price, photos, words, and rank come from Amazon. Star ratings, review text, Amazon's Choice,
        and how many were bought recently aren't included, because Amazon doesn't share them.
      </Note>
    </EmailLayout>
  );
}

ListingChanges.PreviewProps = {
  organizationName: "Kazomo Inc.",
  url: "http://localhost:3000/o/kazomo/commerce/watch",
  items: [
    {
      title: "Stone coaster",
      channelName: "Amazon.com",
      summary: "Price went from US$19.99 to US$17.49.",
      href: "http://localhost:3000/o/kazomo/commerce/watch/1",
    },
    {
      title: "Linen towel",
      channelName: "Amazon.ca",
      summary: "The main photo changed.",
      href: "http://localhost:3000/o/kazomo/commerce/watch/2",
    },
  ],
} satisfies ListingChangesProps;
