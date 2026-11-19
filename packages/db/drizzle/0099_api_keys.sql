CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"access" text DEFAULT 'read' NOT NULL,
	"organization_ids" uuid[],
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_name_present" CHECK (length(trim("api_keys"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "api_keys_own" ON "api_keys" AS PERMISSIVE FOR ALL TO public USING ("api_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("api_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- Checking a key on an API request, before anyone is known: finds the one key with this hash
-- (and nothing else), so the runtime role never reads other people's keys.
CREATE OR REPLACE FUNCTION api_key_lookup(p_hash text)
RETURNS TABLE (id uuid, user_id uuid, access text, organization_ids uuid[], expires_at timestamptz, revoked_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.user_id, k.access, k.organization_ids, k.expires_at, k.revoked_at
  FROM api_keys k WHERE k.key_hash = p_hash
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION api_key_lookup(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api_key_lookup(text) TO app_runtime;--> statement-breakpoint
-- When a key was last used, at most once a minute (no write on every request).
CREATE OR REPLACE FUNCTION api_key_touch(p_id uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_keys SET last_used_at = now()
  WHERE id = p_id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION api_key_touch(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api_key_touch(uuid) TO app_runtime;
