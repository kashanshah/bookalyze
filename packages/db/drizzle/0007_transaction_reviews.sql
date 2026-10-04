CREATE TABLE "transaction_reviews" (
	"organization_id" uuid NOT NULL,
	"journal_entry_id" uuid PRIMARY KEY NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_reviews" ADD CONSTRAINT "transaction_reviews_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_reviews" ADD CONSTRAINT "transaction_reviews_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_reviews" ADD CONSTRAINT "transaction_reviews_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "transaction_reviews_tenant_isolation" ON "transaction_reviews" AS PERMISSIVE FOR ALL TO public USING ("transaction_reviews"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("transaction_reviews"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);