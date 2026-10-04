-- tutor_decisions.riskLevel exists in packages/core/src/db/schema.ts but was
-- never given a migration, so drizzle would emit SQL against a missing column.
ALTER TABLE tutor_decisions ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'low';
