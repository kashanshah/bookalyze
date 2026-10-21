CREATE SEQUENCE "public"."support_ticket_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"organization_id" uuid,
	"author_user_id" uuid,
	"author_email" text,
	"author_name" text,
	"from_support" boolean DEFAULT false NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"via" text DEFAULT 'app' NOT NULL,
	"email_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_messages_body_length" CHECK (length(trim("support_messages"."body")) between 1 and 20000),
	CONSTRAINT "support_messages_via_valid" CHECK ("support_messages"."via" in ('app', 'email', 'website')),
	CONSTRAINT "support_messages_internal_from_support" CHECK (not "support_messages"."internal" or "support_messages"."from_support")
);
--> statement-breakpoint
ALTER TABLE "support_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer DEFAULT nextval('support_ticket_number_seq') NOT NULL,
	"organization_id" uuid,
	"requester_user_id" uuid,
	"requester_email" text NOT NULL,
	"requester_name" text,
	"subject" text NOT NULL,
	"topic" text DEFAULT 'question' NOT NULL,
	"status" text DEFAULT 'waiting_on_us' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"assigned_to" uuid,
	"source" text DEFAULT 'app' NOT NULL,
	"page" text,
	"token" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_tickets_status_valid" CHECK ("support_tickets"."status" in ('open', 'waiting_on_you', 'waiting_on_us', 'solved', 'closed')),
	CONSTRAINT "support_tickets_priority_valid" CHECK ("support_tickets"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "support_tickets_topic_valid" CHECK ("support_tickets"."topic" in ('question', 'help', 'billing', 'bug', 'coverage', 'other')),
	CONSTRAINT "support_tickets_source_valid" CHECK ("support_tickets"."source" in ('app', 'website')),
	CONSTRAINT "support_tickets_token_valid" CHECK ("support_tickets"."token" ~ '^[a-z0-9]{20,64}$'),
	CONSTRAINT "support_tickets_subject_length" CHECK (length(trim("support_tickets"."subject")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_requester_user_id_user_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_messages_ticket_idx" ON "support_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_email_ref_key" ON "support_messages" USING btree ("email_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "support_tickets_token_key" ON "support_tickets" USING btree ("token");--> statement-breakpoint
CREATE INDEX "support_tickets_org_idx" ON "support_tickets" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE POLICY "support_messages_visibility" ON "support_messages" AS PERMISSIVE FOR ALL TO public USING ((("support_messages"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and not "support_messages"."internal") or current_setting('app.support_desk', true) = 'on')) WITH CHECK ((("support_messages"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid and not "support_messages"."internal") or current_setting('app.support_desk', true) = 'on'));--> statement-breakpoint
CREATE POLICY "support_tickets_visibility" ON "support_tickets" AS PERMISSIVE FOR ALL TO public USING (("support_tickets"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid or current_setting('app.support_desk', true) = 'on')) WITH CHECK (("support_tickets"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid or current_setting('app.support_desk', true) = 'on'));--> statement-breakpoint
-- A message always carries its ticket's company, whoever writes it, so a reply from the support
-- desk is seen by the company and a customer can't post onto another company's ticket.
CREATE OR REPLACE FUNCTION support_message_org() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ticket_org uuid;
BEGIN
  SELECT t.organization_id INTO ticket_org FROM support_tickets t WHERE t.id = NEW.ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'support ticket % not found', NEW.ticket_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.organization_id := ticket_org;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER support_messages_org BEFORE INSERT OR UPDATE OF ticket_id, organization_id ON support_messages
FOR EACH ROW EXECUTE FUNCTION support_message_org();
