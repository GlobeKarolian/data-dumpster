CREATE TABLE "user_landscape_access" (
	"user_id" uuid NOT NULL,
	"landscape_id" uuid NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_landscape_access_user_id_landscape_id_pk" PRIMARY KEY("user_id","landscape_id")
);
--> statement-breakpoint
ALTER TABLE "user_landscape_access" ADD CONSTRAINT "user_landscape_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_landscape_access" ADD CONSTRAINT "user_landscape_access_landscape_id_landscapes_id_fk" FOREIGN KEY ("landscape_id") REFERENCES "public"."landscapes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_landscape_access" ADD CONSTRAINT "user_landscape_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_landscape_access_landscape_idx" ON "user_landscape_access" USING btree ("landscape_id");--> statement-breakpoint
INSERT INTO "user_landscape_access" ("user_id", "landscape_id")
SELECT u."id", l."id"
  FROM "users" u
  JOIN "landscapes" l ON l."org_id" = u."org_id"
 WHERE u."role" IN ('editor'::role, 'viewer'::role)
ON CONFLICT ("user_id", "landscape_id") DO NOTHING;
