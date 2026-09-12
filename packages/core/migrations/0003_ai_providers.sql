CREATE TABLE IF NOT EXISTS "ai_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_type" text NOT NULL,
  "display_name" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key_encrypted" text,
  "enabled" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 0,
  "config" jsonb NOT NULL DEFAULT '{}',
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ai_provider_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_id" uuid NOT NULL REFERENCES "ai_providers"("id") ON DELETE CASCADE,
  "model_id" text NOT NULL,
  "display_name" text NOT NULL,
  "capabilities" jsonb NOT NULL DEFAULT '{}',
  "context_window" integer NOT NULL DEFAULT 4096,
  "output_limit" integer NOT NULL DEFAULT 4096,
  "cost_per_1k_in" real NOT NULL DEFAULT 0,
  "cost_per_1k_out" real NOT NULL DEFAULT 0,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_providers_type_idx" ON "ai_providers" ("provider_type");
CREATE INDEX IF NOT EXISTS "ai_providers_enabled_idx" ON "ai_providers" ("enabled");
CREATE UNIQUE INDEX IF NOT EXISTS "ai_provider_models_provider_model_idx" ON "ai_provider_models" ("provider_id", "model_id");
