CREATE TABLE "rule_suggestion_dismissals" (
	"organization_id" uuid NOT NULL,
	"match_text" text NOT NULL,
	"dismissed_by" uuid,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_suggestion_dismissals_key" UNIQUE("organization_id","match_text")
);
--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissals" ADD CONSTRAINT "rule_suggestion_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_dismissals" ADD CONSTRAINT "rule_suggestion_dismissals_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "rule_suggestion_dismissals_tenant_isolation" ON "rule_suggestion_dismissals" AS PERMISSIVE FOR ALL TO public USING ("rule_suggestion_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("rule_suggestion_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);