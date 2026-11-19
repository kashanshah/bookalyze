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
	"client_id" text,
	"refresh_hash" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_key" UNIQUE("key_hash"),
	CONSTRAINT "api_keys_refresh_hash_key" UNIQUE("refresh_hash"),
	CONSTRAINT "api_keys_name_present" CHECK (length(trim("api_keys"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"secret_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"access" text NOT NULL,
	"organization_ids" uuid[],
	"lifetime_days" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_keys_client_idx" ON "api_keys" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_expires_idx" ON "oauth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "api_keys_own" ON "api_keys" AS PERMISSIVE FOR ALL TO public USING ("api_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("api_keys"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- Checking a key on an API request, before anyone is known: finds the one key with this hash
-- (and nothing else), so the runtime role never reads other people's keys.
CREATE OR REPLACE FUNCTION api_key_lookup(p_hash text)
RETURNS TABLE (id uuid, user_id uuid, access text, organization_ids uuid[], expires_at timestamptz, revoked_at timestamptz, token_expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.user_id, k.access, k.organization_ids, k.expires_at, k.revoked_at, k.token_expires_at
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
GRANT EXECUTE ON FUNCTION api_key_touch(uuid) TO app_runtime;--> statement-breakpoint
-- OAuth refresh: swaps in a new access token and refresh token for the connection that holds
-- this refresh token (and belongs to this app), if it's still live. The old pair stops working.
CREATE FUNCTION oauth_refresh(p_refresh_hash text, p_client_id text, p_key_hash text, p_prefix text, p_new_refresh_hash text, p_token_expires_at timestamptz)
RETURNS TABLE (id uuid, user_id uuid, access text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_keys k
  SET key_hash = p_key_hash, prefix = p_prefix, refresh_hash = p_new_refresh_hash,
      token_expires_at = p_token_expires_at
  WHERE k.refresh_hash = p_refresh_hash AND k.client_id = p_client_id AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
  RETURNING k.id, k.user_id, k.access
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION oauth_refresh(text, text, text, text, text, timestamptz) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION oauth_refresh(text, text, text, text, text, timestamptz) TO app_runtime;--> statement-breakpoint
-- OAuth revocation (RFC 7009): revokes the app's connection holding this access or refresh token.
CREATE FUNCTION oauth_revoke(p_hash text, p_client_id text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE api_keys SET revoked_at = now()
  WHERE (key_hash = p_hash OR refresh_hash = p_hash) AND client_id = p_client_id AND revoked_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION oauth_revoke(text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION oauth_revoke(text, text) TO app_runtime;
