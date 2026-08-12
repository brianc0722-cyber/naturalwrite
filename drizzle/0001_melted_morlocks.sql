ALTER TABLE "ai_scans" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "writing_samples" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_scans" ADD CONSTRAINT "ai_scans_public_id_unique" UNIQUE("public_id");--> statement-breakpoint
ALTER TABLE "writing_samples" ADD CONSTRAINT "writing_samples_public_id_unique" UNIQUE("public_id");