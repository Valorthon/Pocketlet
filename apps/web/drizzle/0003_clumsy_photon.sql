ALTER TABLE "users" ADD COLUMN "passkey_challenge" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "passkey_challenge_expires_at" timestamp with time zone;