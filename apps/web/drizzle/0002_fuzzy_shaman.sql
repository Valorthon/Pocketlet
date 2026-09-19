-- Everything below the cleanup block is drizzle-kit output; the DELETEs above
-- it were added by hand, which the usual rule forbids. The exception is
-- deliberate: migrations run at boot (src/instrumentation.ts) and at test
-- import (vitest.setup.ts), so ADD CONSTRAINT against a single pre-existing
-- orphan row aborts startup and takes the deploy — or the whole suite — with
-- it. Orphans are likely in any long-lived development database, because
-- resetDatabase() used to delete parent `users` rows while leaving
-- `user_devices`, `claim_links` and `notifications` behind (issue #62).
--
-- Order matters: removing claim links whose sender is gone orphans their
-- notifications, so notifications are swept second.

DELETE FROM "claim_links" cl
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."email" = cl."sender_email");
--> statement-breakpoint
DELETE FROM "notifications" n
WHERE NOT EXISTS (SELECT 1 FROM "claim_links" cl WHERE cl."id" = n."claim_link_id");
--> statement-breakpoint
DELETE FROM "user_devices" d
WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."email" = d."email");
--> statement-breakpoint
ALTER TABLE "claim_links" ADD CONSTRAINT "claim_links_sender_email_users_email_fk" FOREIGN KEY ("sender_email") REFERENCES "public"."users"("email") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_claim_link_id_claim_links_id_fk" FOREIGN KEY ("claim_link_id") REFERENCES "public"."claim_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_email_users_email_fk" FOREIGN KEY ("email") REFERENCES "public"."users"("email") ON DELETE cascade ON UPDATE no action;