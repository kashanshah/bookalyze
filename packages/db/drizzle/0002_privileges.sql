-- Reference data is read-only for the app.
REVOKE INSERT, UPDATE, DELETE ON "currencies", "countries", "subdivisions" FROM app_runtime;
--> statement-breakpoint
-- The audit log is append-only for the app.
REVOKE UPDATE, DELETE ON "audit_logs" FROM app_runtime;
