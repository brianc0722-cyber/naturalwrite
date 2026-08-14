CREATE TABLE "grammar_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"file_name" varchar(255) DEFAULT 'Pasted text' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"score" integer NOT NULL,
	"verdict" varchar(60) NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"suggestion_count" integer DEFAULT 0 NOT NULL,
	"source" varchar(20) DEFAULT 'paste' NOT NULL,
	"issues" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"llm_model" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grammar_checks_public_id_unique" UNIQUE("public_id")
);
