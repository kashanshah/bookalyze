ALTER TABLE "orders" ADD COLUMN "review_eligible" boolean;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "review_checked_at" timestamp with time zone;--> statement-breakpoint
-- The hourly job also checks with Amazon which recent shipped orders can be asked for a review,
-- for every company with an Amazon marketplace bringing orders in (it checks the company's plan).
CREATE OR REPLACE FUNCTION review_request_orgs() RETURNS TABLE (organization_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.organization_id FROM review_settings s WHERE s.enabled
  UNION
  SELECT r.organization_id FROM review_requests r WHERE r.status = 'scheduled' AND r.due_at <= now()
  UNION
  SELECT c.organization_id FROM sales_channels c WHERE c.is_active AND c.orders_from IS NOT NULL
$$;
