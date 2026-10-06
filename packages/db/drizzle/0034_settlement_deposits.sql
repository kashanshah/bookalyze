CREATE TABLE "settlement_deposit_dismissals" (
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_deposit_dismissals_settlement_id_journal_entry_id_pk" PRIMARY KEY("settlement_id","journal_entry_id")
);
--> statement-breakpoint
ALTER TABLE "settlement_deposit_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "deposit_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "deposit_original_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "settlement_deposit_dismissals" ADD CONSTRAINT "settlement_deposit_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_deposit_dismissals" ADD CONSTRAINT "settlement_deposit_dismissals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_deposit_dismissals" ADD CONSTRAINT "settlement_deposit_dismissals_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_deposit_dismissals" ADD CONSTRAINT "settlement_deposit_dismissals_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deposit_entry_fk" FOREIGN KEY ("organization_id","deposit_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_deposit_original_entry_fk" FOREIGN KEY ("organization_id","deposit_original_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "settlement_deposit_dismissals_tenant_isolation" ON "settlement_deposit_dismissals" AS PERMISSIVE FOR ALL TO public USING ("settlement_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlement_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);