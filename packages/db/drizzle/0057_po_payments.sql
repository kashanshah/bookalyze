CREATE TABLE "purchase_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"receipt_id" uuid,
	"contact_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"label" text,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_payments_amount_positive" CHECK ("purchase_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "payment_plan" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_po_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_receipt_fk" FOREIGN KEY ("organization_id","receipt_id") REFERENCES "public"."purchase_receipts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_payments_po_idx" ON "purchase_payments" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "purchase_payments_entry_idx" ON "purchase_payments" USING btree ("journal_entry_id");--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_contact_fk" FOREIGN KEY ("organization_id","contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "purchase_payments_tenant_isolation" ON "purchase_payments" AS PERMISSIVE FOR ALL TO public USING ("purchase_payments"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_payments"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);