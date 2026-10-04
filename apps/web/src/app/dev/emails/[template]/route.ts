import { render } from "@react-email/render";
import { createElement } from "react";
import { type EmailTemplateKey, emailTemplates } from "@/emails";

/** Development-only HTML preview of an email template with sample data. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ template: string }> },
) {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_DEV_LOG !== "true") {
    return new Response("Not found", { status: 404 });
  }
  const { template } = await params;
  const entry = emailTemplates[template as EmailTemplateKey];
  if (!entry) return new Response("Not found", { status: 404 });
  const Component = entry.component as unknown as React.FC<object> & { PreviewProps: object };
  const html = await render(createElement(Component, Component.PreviewProps));
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
