CREATE TABLE "attachment_links" (
	"organization_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_links_attachment_id_entity_type_entity_id_pk" PRIMARY KEY("attachment_id","entity_type","entity_id"),
	CONSTRAINT "attachment_links_entity_type_valid" CHECK ("attachment_links"."entity_type" in ('journal_entry'))
);
--> statement-breakpoint
ALTER TABLE "attachment_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "attachments_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" > 0),
	CONSTRAINT "attachments_status_valid" CHECK ("attachments"."status" in ('pending', 'ready'))
);
--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment_links" ADD CONSTRAINT "attachment_links_attachment_fk" FOREIGN KEY ("organization_id","attachment_id") REFERENCES "public"."attachments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_links_entity_idx" ON "attachment_links" USING btree ("organization_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "attachments_org_created_idx" ON "attachments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE POLICY "attachment_links_tenant_isolation" ON "attachment_links" AS PERMISSIVE FOR ALL TO public USING ("attachment_links"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("attachment_links"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "attachments_tenant_isolation" ON "attachments" AS PERMISSIVE FOR ALL TO public USING ("attachments"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("attachments"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);