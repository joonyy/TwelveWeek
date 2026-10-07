ALTER TABLE ai_oauth_tokens ADD COLUMN grant_id uuid;
UPDATE ai_oauth_tokens SET grant_id=gen_random_uuid() WHERE grant_id IS NULL;
ALTER TABLE ai_oauth_tokens ALTER COLUMN grant_id SET NOT NULL;
CREATE INDEX ai_oauth_tokens_grant_idx ON ai_oauth_tokens(grant_id,profile_id);
