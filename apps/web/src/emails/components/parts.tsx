import { Button, Heading, Link, Section, Text } from "@react-email/components";
import { brand } from "./theme";

export function Title({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h1"
      style={{
        margin: "0 0 12px",
        fontSize: 24,
        lineHeight: "32px",
        fontWeight: 650,
        color: brand.ink,
        letterSpacing: "-0.015em",
      }}
    >
      {children}
    </Heading>
  );
}

export function Paragraph({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <Text
      style={{
        margin: "0 0 16px",
        fontSize: 15,
        lineHeight: "24px",
        color: muted ? brand.muted : brand.text,
      }}
    >
      {children}
    </Text>
  );
}

export function CallToAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ margin: "28px 0 24px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: brand.primary,
          color: "#FFFFFF",
          fontSize: 15,
          fontWeight: 600,
          lineHeight: "20px",
          borderRadius: 10,
          padding: "13px 22px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** Plain URL for when the button doesn't work (corporate mail filters, some clients). */
export function FallbackLink({ href }: { href: string }) {
  return (
    <Section
      style={{
        backgroundColor: brand.canvas,
        borderRadius: 10,
        padding: "12px 14px",
        marginTop: 8,
      }}
    >
      <Text style={{ margin: "0 0 4px", fontSize: 12, lineHeight: "18px", color: brand.muted }}>
        Button not working? Copy and paste this link into your browser:
      </Text>
      <Link
        href={href}
        style={{ fontSize: 12, lineHeight: "18px", color: brand.primary, wordBreak: "break-all" }}
      >
        {href}
      </Link>
    </Section>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ margin: "20px 0 0", fontSize: 13, lineHeight: "20px", color: brand.muted }}>
      {children}
    </Text>
  );
}
