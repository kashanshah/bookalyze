ALTER TABLE "purchase_payments" ADD CONSTRAINT "purchase_payments_org_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_payment_key" UNIQUE("payment_id");--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_payment_fk" FOREIGN KEY ("organization_id","payment_id") REFERENCES "public"."purchase_payments"("organization_id","id") ON DELETE no action ON UPDATE no action;
