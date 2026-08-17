-- OpenRouter becomes a first-class model provider. IF NOT EXISTS keeps the
-- migration re-runnable; ADD VALUE is safe under the Neon HTTP driver because
-- statements run outside transaction blocks.
ALTER TYPE "public"."model_provider" ADD VALUE IF NOT EXISTS 'openrouter' BEFORE 'openai_compatible';
