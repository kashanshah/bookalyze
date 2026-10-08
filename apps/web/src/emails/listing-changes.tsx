import { Column, Img, Link, Row, Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CallToAction, Note, Paragraph, Title } from "./components/parts";
import { brand } from "./components/theme";

export type ListingChangeLine = {
  /** "Best seller rank", "Price"… */
  label: string;
  summary: string;
  /** For a best seller rank: "up" when it climbed (a lower number is better). */
  trend: "up" | "down" | null;
  /** "▲ 254": how many places it moved. */
  badge: string | null;
};

export type ListingChangesProps = {
  organizationName: string;
  url: string;
  items: {
    title: string;
    channelName: string;
    asin: string;
    imageUrl: string | null;
    href: string;
    changes: ListingChangeLine[];
  }[];
};

/** Changes shown per product; the rest are on its page. */
const SHOWN = 4;

function TrendBadge({ trend, badge }: { trend: "up" | "down"; badge: string }) {
  const up = trend === "up";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 12,
        lineHeight: "20px",
        fontWeight: 650,
        whiteSpace: "nowrap",
        color: up ? brand.up : brand.down,
        backgroundColor: up ? brand.upSoft : brand.downSoft,
      }}
    >
      {badge}
    </span>
  );
}

function ChangeRow({ change, first }: { change: ListingChangeLine; first: boolean }) {
  return (
    <Section style={{ borderTop: first ? "none" : `1px solid ${brand.border}`, padding: "10px 0" }}>
      <Text
        style={{
          margin: 0,
          fontSize: 11,
          lineHeight: "16px",
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: brand.muted,
        }}
      >
        {change.label}
      </Text>
      <Text style={{ margin: "2px 0 0", fontSize: 14, lineHeight: "22px", color: brand.text }}>
        {change.summary}
        {change.trend && change.badge ? (
          <>
            {"\u00a0 "}
            <TrendBadge trend={change.trend} badge={change.badge} />
          </>
        ) : null}
      </Text>
    </Section>
  );
}

function ProductCard({ item }: { item: ListingChangesProps["items"][number] }) {
  const shown = item.changes.slice(0, SHOWN);
  const more = item.changes.length - shown.length;
  return (
    <Section
      style={{
        border: `1px solid ${brand.border}`,
        borderRadius: 14,
        padding: "14px 16px 6px",
        margin: "12px 0 0",
        backgroundColor: brand.card,
      }}
    >
      <Row>
        {item.imageUrl ? (
          <Column style={{ width: 64, verticalAlign: "top" }}>
            <Img
              src={item.imageUrl}
              width={52}
              height={52}
              alt=""
              style={{
                display: "block",
                width: 52,
                height: 52,
                objectFit: "contain",
                borderRadius: 10,
                border: `1px solid ${brand.border}`,
                backgroundColor: "#FFFFFF",
              }}
            />
          </Column>
        ) : null}
        <Column style={{ verticalAlign: "top" }}>
          <Text style={{ margin: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600 }}>
            <Link href={item.href} style={{ color: brand.ink, textDecoration: "none" }}>
              {item.title}
            </Link>
          </Text>
          <Text style={{ margin: "2px 0 0", fontSize: 12, lineHeight: "18px", color: brand.muted }}>
            {item.channelName} · ASIN {item.asin}
          </Text>
        </Column>
      </Row>
      <Section style={{ marginTop: 8 }}>
        {shown.map((change, index) => (
          <ChangeRow
            key={`${change.label}-${change.summary}`}
            change={change}
            first={index === 0}
          />
        ))}
      </Section>
      <Text style={{ margin: "0 0 8px", fontSize: 13, lineHeight: "20px" }}>
        <Link href={item.href} style={{ color: brand.primary, fontWeight: 600 }}>
          {more > 0 ? `See ${more} more ${more === 1 ? "change" : "changes"} →` : "Open product →"}
        </Link>
      </Text>
    </Section>
  );
}

/** One email when watched products change: one card per product, one row per change. */
export function ListingChanges({ organizationName, url, items }: ListingChangesProps) {
  const first = items[0];
  const total = items.reduce((sum, item) => sum + item.changes.length, 0);
  const ranked = items.some((item) => item.changes.some((change) => change.trend));
  const company = organizationName;
  // "Kazomo Inc." already ends the sentence; anything else gets its full stop.
  const stop = company.endsWith(".") ? "" : ".";
  return (
    <EmailLayout
      preview={
        items.length === 1 && first
          ? `${first.title}: ${first.changes[0]?.summary ?? "it changed on Amazon."}`
          : `${total} changes across ${items.length} products for ${company}${stop}`
      }
      footerNote={`You're receiving this because you're an owner or admin of ${company} in Bookalyze, and listing watch has email turned on. Pause a product, or turn email off, and it won't be mentioned again.`}
    >
      <Title>
        {items.length === 1 && first
          ? `${first.title} changed`
          : `${items.length} products changed`}
      </Title>
      <Paragraph muted>
        {total === 1 ? "One change" : `${total} changes`} on Amazon since the last look, for{" "}
        <strong style={{ color: brand.ink }}>{company}</strong>
        {stop}
      </Paragraph>
      {items.map((item) => (
        <ProductCard key={item.href} item={item} />
      ))}
      {ranked ? (
        <Text style={{ margin: "14px 0 0", fontSize: 12, lineHeight: "18px", color: brand.muted }}>
          <span style={{ color: brand.up, fontWeight: 650 }}>▲ Green</span>: the best seller rank
          climbed (a lower number means more sales in that category).{" "}
          <span style={{ color: brand.down, fontWeight: 650 }}>▼ Red</span>: it fell.
        </Text>
      ) : null}
      <CallToAction href={url}>See all watched products</CallToAction>
      <Note>
        Prices, photos, words and ranks come from Amazon. Star ratings, review text and Amazon's
        Choice aren't included, because Amazon doesn't share them.
      </Note>
    </EmailLayout>
  );
}

ListingChanges.PreviewProps = {
  organizationName: "Kazomo Inc.",
  url: "http://localhost:3000/o/kazomo/commerce/watch",
  items: [
    {
      title: "Stone coaster set of 4",
      channelName: "Amazon.com",
      asin: "B0E2E00001",
      imageUrl: null,
      href: "http://localhost:3000/o/kazomo/commerce/watch/1",
      changes: [
        {
          label: "Best seller rank",
          summary: "Climbed from #1,234 to #980 in Kitchen & Dining.",
          trend: "up",
          badge: "▲ 254",
        },
        {
          label: "Best seller rank",
          summary: "Fell from #40 to #61 in Coasters.",
          trend: "down",
          badge: "▼ 21",
        },
        {
          label: "Price",
          summary: "Price went from US$19.99 to US$17.49.",
          trend: null,
          badge: null,
        },
      ],
    },
    {
      title: "Linen towel",
      channelName: "Amazon.ca",
      asin: "B0E2E00002",
      imageUrl: null,
      href: "http://localhost:3000/o/kazomo/commerce/watch/2",
      changes: [{ label: "Photos", summary: "The main photo changed.", trend: null, badge: null }],
    },
  ],
} satisfies ListingChangesProps;
