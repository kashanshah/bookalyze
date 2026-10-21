ALTER TABLE "invoice_inboxes" ADD COLUMN "last_receipt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "source" text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "email_from" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "email_subject" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "email_ref" text;--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_email_ref_key" ON "attachments" USING btree ("organization_id","email_ref") WHERE "attachments"."email_ref" is not null;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_source_valid" CHECK ("attachments"."source" in ('upload', 'email'));