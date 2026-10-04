import { EmailLayout } from "./components/layout";
import { CallToAction, FallbackLink, Note, Paragraph, Title } from "./components/parts";

export type ResetPasswordProps = { name: string; url: string };

export function ResetPassword({ name, url }: ResetPasswordProps) {
  const firstName = name.split(" ")[0] || name;
  return (
    <EmailLayout
      preview="Use this link to choose a new password for Bookalyze."
      footerNote="You're receiving this because a password reset was requested for your Bookalyze account. If you didn't ask for this, you can safely ignore this email; your password won't change."
    >
      <Title>Reset your password</Title>
      <Paragraph>Hi {firstName},</Paragraph>
      <Paragraph>
        We received a request to reset the password for your Bookalyze account. Click the button
        below to choose a new one.
      </Paragraph>
      <CallToAction href={url}>Choose a new password</CallToAction>
      <FallbackLink href={url} />
      <Note>
        This link expires in 1 hour. After you reset your password, you'll be signed out of
        Bookalyze on your other devices.
      </Note>
    </EmailLayout>
  );
}

ResetPassword.PreviewProps = {
  name: "Kashan Shah",
  url: "https://app.bookalyze.com/reset-password?token=preview",
} satisfies ResetPasswordProps;

export default ResetPassword;
