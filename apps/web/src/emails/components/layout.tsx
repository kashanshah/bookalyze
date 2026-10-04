import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { brand } from "./theme";

/**
 * Hosted PNG logo (email clients don't render SVG reliably). Served from the app's public folder,
 * so it loads wherever the app is deployed. Alt text keeps the brand visible if images are blocked.
 */
const ASSET_BASE = (process.env.BETTER_AUTH_URL ?? "https://app.bookalyze.com").replace(/\/$/, "");

function Logo() {
  return (
    <Img
      src={`${ASSET_BASE}/brand/logo-email.png`}
      width={180}
      height={38}
      alt="Bookalyze"
      style={{
        display: "block",
        border: 0,
        outline: "none",
        color: brand.ink,
        fontSize: 20,
        fontWeight: 700,
      }}
    />
  );
}

export function EmailLayout({
  preview,
  children,
  footerNote,
}: {
  /** Inbox preview line shown after the subject. */
  preview: string;
  children: React.ReactNode;
  /** Why the recipient got this email. */
  footerNote: string;
}) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          backgroundColor: brand.canvas,
          fontFamily: brand.font,
          padding: "32px 12px",
        }}
      >
        <Container style={{ maxWidth: 560, margin: "0 auto" }}>
          <Section style={{ padding: "0 8px 20px" }}>
            <Logo />
          </Section>
          <Section
            style={{
              backgroundColor: brand.card,
              border: `1px solid ${brand.border}`,
              borderRadius: 16,
              padding: "36px 36px 32px",
            }}
          >
            {children}
          </Section>
          <Section style={{ padding: "24px 8px 0" }}>
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: brand.muted }}>
              {footerNote}
            </Text>
            <Hr style={{ borderColor: brand.border, margin: "16px 0" }} />
            <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: brand.muted }}>
              Bookalyze · Bookkeeping, banking and marketplace sales for every company you run.
              <br />
              <Link
                href="https://bookalyze.com"
                style={{ color: brand.muted, textDecoration: "underline" }}
              >
                bookalyze.com
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
