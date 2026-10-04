import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./components/layout";
import { CallToAction, FallbackLink, Note, Paragraph, Title } from "./components/parts";
import { brand } from "./components/theme";

export type InvitationProps = {
  inviterName: string;
  inviterEmail: string;
  organizationName: string;
  role: string;
  url: string;
};

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };
const ROLE_HELP: Record<string, string> = {
  owner: "Full control of the company.",
  admin: "Can change settings and invite people.",
  member: "Can use the books and features.",
};

export function Invitation({
  inviterName,
  inviterEmail,
  organizationName,
  role,
  url,
}: InvitationProps) {
  const initial = organizationName.trim().charAt(0).toUpperCase() || "B";
  return (
    <EmailLayout
      preview={`${inviterName} invited you to ${organizationName} on Bookalyze.`}
      footerNote={`You're receiving this because ${inviterName} (${inviterEmail}) invited this email address to ${organizationName.replace(/\.$/, "")}. If you weren't expecting it, you can ignore this email.`}
    >
      <Title>You're invited to join {organizationName}</Title>
      <Paragraph>
        <strong style={{ color: brand.ink }}>{inviterName}</strong> ({inviterEmail}) has invited you
        to collaborate on <strong style={{ color: brand.ink }}>{organizationName}</strong> in
        Bookalyze.
      </Paragraph>

      <Section
        style={{
          border: `1px solid ${brand.border}`,
          borderRadius: 12,
          padding: 16,
          margin: "8px 0 0",
        }}
      >
        <table
          cellPadding={0}
          cellSpacing={0}
          role="presentation"
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <tbody>
            <tr>
              <td style={{ width: 44, verticalAlign: "middle" }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    backgroundColor: brand.soft,
                    color: brand.primaryDark,
                    fontSize: 17,
                    fontWeight: 700,
                    textAlign: "center",
                    lineHeight: "40px",
                  }}
                >
                  {initial}
                </div>
              </td>
              <td style={{ paddingLeft: 12, verticalAlign: "middle" }}>
                <Text
                  style={{
                    margin: 0,
                    fontSize: 15,
                    lineHeight: "20px",
                    fontWeight: 600,
                    color: brand.ink,
                  }}
                >
                  {organizationName}
                </Text>
                <Text style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: brand.muted }}>
                  Your access: {ROLE_LABEL[role] ?? role} · {ROLE_HELP[role] ?? ""}
                </Text>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <CallToAction href={url}>Accept invitation</CallToAction>
      <FallbackLink href={url} />
      <Note>
        This invitation expires in 7 days. You'll only see {organizationName}, not any other
        companies on Bookalyze.
      </Note>
    </EmailLayout>
  );
}

Invitation.PreviewProps = {
  inviterName: "Kashan Shah",
  inviterEmail: "owner@example.com",
  organizationName: "Kazomo Inc.",
  role: "admin",
  url: "https://app.bookalyze.com/accept-invitation/preview",
} satisfies InvitationProps;

export default Invitation;
