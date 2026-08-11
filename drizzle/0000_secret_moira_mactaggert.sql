CREATE TABLE "ai_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" varchar(255) DEFAULT 'Pasted text' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"score" integer NOT NULL,
	"verdict" varchar(60) NOT NULL,
	"signals" jsonb NOT NULL,
	"style_match" jsonb,
	"ai_opinion" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rewrite_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"original_text" text NOT NULL,
	"rewritten_text" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(120) DEFAULT 'My writing style' NOT NULL,
	"profile" jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writing_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) DEFAULT 'Untitled sample' NOT NULL,
	"content" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"source" varchar(50) DEFAULT 'paste' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
