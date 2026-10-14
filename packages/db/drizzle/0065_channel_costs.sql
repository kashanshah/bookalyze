CREATE TABLE "channel_cost_accounts" (
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"channel_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_cost_accounts_organization_id_account_id_pk" PRIMARY KEY("organization_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "channel_cost_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_cost_accounts" ADD CONSTRAINT "channel_cost_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_cost_accounts" ADD CONSTRAINT "channel_cost_accounts_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_cost_accounts" ADD CONSTRAINT "channel_cost_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_cost_accounts" ADD CONSTRAINT "channel_cost_accounts_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "channel_cost_accounts_tenant_isolation" ON "channel_cost_accounts" AS PERMISSIVE FOR ALL TO public USING ("channel_cost_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("channel_cost_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);