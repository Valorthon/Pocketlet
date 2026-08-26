CREATE TABLE "metrics" (
	"key" text NOT NULL,
	"period" text DEFAULT 'total' NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_key_period_pk" PRIMARY KEY("key","period")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"email" text PRIMARY KEY NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"verification_code" text,
	"pending_challenge" text,
	"credential" jsonb,
	"wallet_contract_id" text,
	"stellar_address" text,
	"primary_passkey_key_id" text,
	"recovery_public_key" text,
	"recovery_phrase_confirmed" boolean DEFAULT false,
	"has_backup_passkey" boolean DEFAULT false,
	"backup_credential" jsonb,
	"pin_hash" text,
	"pin_reset_code" text,
	"recovery_initiated_at" timestamp with time zone,
	"recovery_initiation_history" jsonb,
	"recovery_code" text,
	"recovery_code_expires_at" timestamp with time zone,
	"recovery_verified_at" timestamp with time zone,
	"recovery_attempts" integer,
	"recovery_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"username" text,
	"phone" text,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
