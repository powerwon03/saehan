CREATE TABLE "login_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_failures" ADD CONSTRAINT "login_failures_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_failures_company_at_idx" ON "login_failures" USING btree ("company_id","at");--> statement-breakpoint
-- Same as 0001_rls: RLS on, no policies (server-only table).
ALTER TABLE "login_failures" ENABLE ROW LEVEL SECURITY;