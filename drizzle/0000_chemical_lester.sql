CREATE TABLE "ai_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"flag_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"action" text NOT NULL,
	"quantity" integer NOT NULL,
	"explanation" text NOT NULL,
	"confidence" text,
	"needs_judgment" boolean NOT NULL,
	"judgment_note" text,
	"valid" boolean NOT NULL,
	"invalid_reasons" jsonb NOT NULL,
	"is_fallback" boolean NOT NULL,
	"input_json" jsonb NOT NULL,
	"raw_response" text,
	"latency_ms" integer NOT NULL,
	"attempts" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"actor_label" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buying_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"sku_name" text NOT NULL,
	"action" text NOT NULL,
	"quantity" integer NOT NULL,
	"source" text NOT NULL,
	"reason_code" text,
	"sink" text DEFAULT 'csv' NOT NULL,
	"sink_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"placed_by" integer,
	"placed_at" timestamp with time zone,
	"order_ref" text
);
--> statement-breakpoint
CREATE TABLE "data_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by" integer,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"as_of_date" text NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"raw_files" jsonb NOT NULL,
	"validation_report" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"to_role" text NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"sku_name" text NOT NULL,
	"category" text NOT NULL,
	"perishability" text NOT NULL,
	"uom" text NOT NULL,
	"distributor_id" text NOT NULL,
	"standard_qty" integer NOT NULL,
	"flag_types" jsonb NOT NULL,
	"avg_weekly_sales" numeric(14, 4) NOT NULL,
	"recent_avg" numeric(14, 4) NOT NULL,
	"demand_ratio" numeric(10, 6) NOT NULL,
	"uplift" numeric(6, 3) NOT NULL,
	"demand_rate" numeric(14, 4) NOT NULL,
	"units_on_hand" integer NOT NULL,
	"cover_weeks" numeric(12, 4),
	"min_cover" numeric(6, 2) NOT NULL,
	"max_cover" numeric(6, 2) NOT NULL,
	"rule_action" text NOT NULL,
	"rule_qty" integer NOT NULL,
	"needs_judgment" boolean NOT NULL,
	"judgment_reasons" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"switch" integer NOT NULL,
	"event" text NOT NULL,
	"metric_value" numeric(16, 4),
	"threshold" numeric(16, 4),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" integer,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kill_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"kill1_state" text DEFAULT 'armed' NOT NULL,
	"kill2_state" text DEFAULT 'green' NOT NULL,
	"kill1_epoch_start" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loss_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"stockout_loss_rupees" numeric(14, 2) NOT NULL,
	"overstock_writeoff_rupees" numeric(14, 2) NOT NULL,
	"entered_by" integer,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"ai_decision_id" integer NOT NULL,
	"reviewer_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"final_action" text NOT NULL,
	"final_qty" integer NOT NULL,
	"final_flag_types" jsonb NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reason_code" text,
	"reason_text" text,
	"break_glass" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_id" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rules_version" text NOT NULL,
	"rules_json" jsonb NOT NULL,
	"as_of_date" text NOT NULL,
	"last_complete_week" text NOT NULL,
	"is_festival" boolean NOT NULL,
	"status" text DEFAULT 'flagged' NOT NULL,
	"evaluated_skus" integer DEFAULT 0 NOT NULL,
	"skipped_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"kill_state_at_run" text DEFAULT 'armed' NOT NULL,
	"ai_started_at" timestamp with time zone,
	"ai_finished_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buying_decisions" ADD CONSTRAINT "buying_decisions_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_snapshots" ADD CONSTRAINT "data_snapshots_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kill_events" ADD CONSTRAINT "kill_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loss_entries" ADD CONSTRAINT "loss_entries_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_ai_decision_id_ai_decisions_id_fk" FOREIGN KEY ("ai_decision_id") REFERENCES "public"."ai_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_snapshot_id_data_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."data_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_decisions_flag_uq" ON "ai_decisions" USING btree ("flag_id");--> statement-breakpoint
CREATE INDEX "ai_decisions_run_idx" ON "ai_decisions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "buying_review_uq" ON "buying_decisions" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "buying_status_idx" ON "buying_decisions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flags_run_idx" ON "flags" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE UNIQUE INDEX "loss_period_uq" ON "loss_entries" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_decision_uq" ON "reviews" USING btree ("ai_decision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));