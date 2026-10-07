CREATE TABLE "order_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"invoice_number" integer NOT NULL,
	"title" text NOT NULL,
	"currency" char(3) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_invoices_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "order_invoices_org_number_key" UNIQUE("organization_id","invoice_number"),
	CONSTRAINT "order_invoices_order_key" UNIQUE("organization_id","order_id"),
	CONSTRAINT "order_invoices_storage_key_key" UNIQUE("storage_key"),
	CONSTRAINT "order_invoices_number_positive" CHECK ("order_invoices"."invoice_number" > 0),
	CONSTRAINT "order_invoices_title_valid" CHECK ("order_invoices"."title" in ('Invoice', 'Tax invoice'))
);
--> statement-breakpoint
ALTER TABLE "order_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_invoices_order_idx" ON "order_invoices" USING btree ("organization_id","order_id");--> statement-breakpoint
CREATE POLICY "order_invoices_tenant_isolation" ON "order_invoices" AS PERMISSIVE FOR ALL TO public USING ("order_invoices"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("order_invoices"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);