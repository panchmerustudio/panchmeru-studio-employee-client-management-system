CREATE TABLE "client_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"client_user_id" text NOT NULL,
	"session_token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "client_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
ALTER TABLE "client_sessions" ADD CONSTRAINT "client_sessions_client_user_id_client_users_id_fk" FOREIGN KEY ("client_user_id") REFERENCES "public"."client_users"("id") ON DELETE cascade ON UPDATE no action;