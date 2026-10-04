import { EmailLayout } from "./components/layout";
import { CallToAction, FallbackLink, Note, Paragraph, Title } from "./components/parts";

export type VerifyEmailProps = { name: string; url: string };

export function VerifyEmail({ name, url }: VerifyEmailProps) {
  const firstName = name.split(" ")[0] || name;
  return (
    <EmailLayout
      preview="Confirm your email to finish setting up Bookalyze."
      footerNote="You're receiving this because someone created a Bookalyze account with this email address. If that wasn't you, you can ignore this email and no account will be activated."
    >
      <Title>Confirm your email address</Title>
      <Paragraph>Hi {firstName},</Paragraph>
      <Paragraph>
        Welcome to Bookalyze. Please confirm this is your email address so we can finish setting up
        your account and keep it secure.
      </Paragraph>
      <CallToAction href={url}>Confirm email address</CallToAction>
      <FallbackLink href={url} />
      <Note>For your security, this link expires in 1 hour and can only be used once.</Note>
    </EmailLayout>
  );
}

VerifyEmail.PreviewProps = {
  name: "Kashan Shah",
  url: "https://app.bookalyze.com/api/auth/verify-email?token=preview",
} satisfies VerifyEmailProps;

export default VerifyEmail;
