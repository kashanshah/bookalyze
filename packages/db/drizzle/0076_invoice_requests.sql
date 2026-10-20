CREATE TABLE "invoice_inboxes" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"last_other_subject" text,
	"last_other_from" text,
	"last_other_at" timestamp with time zone,
	"last_request_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_inboxes_token_valid" CHECK ("invoice_inboxes"."token" ~ '^[a-z0-9]{20,64}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_inboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_order_id" text NOT NULL,
	"order_id" uuid,
	"buyer_name" text,
	"source" text DEFAULT 'email' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_requests_order_key" UNIQUE("organization_id","external_order_id"),
	CONSTRAINT "invoice_requests_status_valid" CHECK ("invoice_requests"."status" in ('open', 'done', 'dismissed')),
	CONSTRAINT "invoice_requests_source_valid" CHECK ("invoice_requests"."source" in ('email', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "invoice_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "sent_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_inboxes" ADD CONSTRAINT "invoice_inboxes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_requests" ADD CONSTRAINT "invoice_requests_order_fk" FOREIGN KEY ("organization_id","order_id") REFERENCES "public"."orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_inboxes_token_key" ON "invoice_inboxes" USING btree ("token");--> statement-breakpoint
CREATE INDEX "invoice_requests_status_idx" ON "invoice_requests" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "invoice_inboxes_tenant_isolation" ON "invoice_inboxes" AS PERMISSIVE FOR ALL TO public USING ("invoice_inboxes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("invoice_inboxes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "invoice_requests_tenant_isolation" ON "invoice_requests" AS PERMISSIVE FOR ALL TO public USING ("invoice_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("invoice_requests"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The inbound email webhook knows only the address an email was sent to. This finds the company
-- whose forwarding address carries the token, without opening any tenant's rows.
CREATE OR REPLACE FUNCTION invoice_inbox_org(p_token text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.organization_id FROM invoice_inboxes i WHERE i.token = p_token
$$;
