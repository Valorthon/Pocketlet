ALTER TABLE "users" ADD COLUMN "verification_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_code_attempts" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_reset_code_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_reset_code_attempts" integer;