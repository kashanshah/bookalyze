ALTER TABLE "connections" DROP CONSTRAINT "connections_provider_valid";--> statement-breakpoint
ALTER TABLE "ad_metrics" DROP CONSTRAINT "ad_metrics_source_valid";--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_valid" CHECK ("connections"."provider" in ('wise', 'csv', 'amazon_sp', 'noon', 'ebay', 'walmart', 'amazon_ads', 'walmart_ads'));--> statement-breakpoint
ALTER TABLE "ad_metrics" ADD CONSTRAINT "ad_metrics_source_valid" CHECK ("ad_metrics"."source" in ('amazon_ads', 'walmart_ads', 'upload'));