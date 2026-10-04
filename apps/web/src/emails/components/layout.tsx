import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { brand } from "./theme";

/** Text-based logo: renders identically in every client (Gmail strips SVG, images may be blocked). */
function Logo() {
  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      role="presentation"
      style={{ borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              backgroundColor: brand.primary,
              color: "#FFFFFF",
              fontFamily: brand.font,
              fontSize: 18,
              fontWeight: 700,
              textAlign: "center",
              lineHeight: "32px",
            }}
          >
            B
          </td>
          <td
            style={{
              paddingLeft: 10,
              fontFamily: brand.font,
              fontSize: 18,
              fontWeight: 650,
              color: brand.ink,
              letterSpacing: "-0.01em",
            }}
          >
            Bookalyze
          </td>
        </tr>
      </tbody>
    </table>
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
