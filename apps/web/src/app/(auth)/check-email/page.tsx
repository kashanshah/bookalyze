import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "@/components/auth/auth-heading";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return (
    <>
      <span className="zoom-in-75 mb-6 flex size-12 animate-in items-center justify-center rounded-2xl bg-primary/10 text-primary duration-500">
        <MailCheck className="size-6" />
      </span>
      <AuthHeading
        title="Check your email"
        description={
          <>
            We sent a confirmation link to{" "}
            {email ? <strong className="text-foreground">{email}</strong> : "your inbox"}. Click it
            to finish setting up your account.
          </>
        }
      />
      <div className="rounded-xl bg-muted/60 p-4 text-muted-foreground text-sm leading-relaxed">
        Can't find it? Check your spam folder, or{" "}
        <Link
          href="/sign-up"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          try a different email
        </Link>
        .
      </div>
    </>
  );
}
