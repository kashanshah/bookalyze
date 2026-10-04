import { notFound } from "next/navigation";
import { emailTemplates } from "@/emails";

export const metadata = { title: "Email previews" };

/** Development-only gallery of email templates. */
export default function EmailPreviewsPage() {
  if (process.env.NODE_ENV === "production" && process.env.EMAIL_DEV_LOG !== "true") notFound();
  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Email previews</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Rendered with sample data. Development only.
        </p>
      </div>
      <div className="grid gap-8 lg:grid-cols-3">
        {Object.entries(emailTemplates).map(([key, t]) => (
          <figure key={key} className="grid gap-2">
            <figcaption className="font-medium text-sm">{t.title}</figcaption>
            <iframe
              title={t.title}
              src={`/dev/emails/${key}`}
              className="h-[720px] w-full rounded-2xl border bg-white shadow-sm"
            />
          </figure>
        ))}
      </div>
    </div>
  );
}
