CREATE TABLE ai_connections (
 profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 provider text NOT NULL CHECK(provider IN ('openai','anthropic')),
 model text NOT NULL, secret_cipher text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(profile_id,provider)
);
CREATE TABLE ai_conversations (
 id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 title text NOT NULL, provider text NOT NULL CHECK(provider IN ('openai','anthropic','codex')),
 source text NOT NULL CHECK(source IN ('native','import','codex')),
 source_label text NOT NULL DEFAULT '', remote_thread_id text,
 messages jsonb NOT NULL DEFAULT '[]', version integer NOT NULL DEFAULT 0,
 busy_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_owner_idx ON ai_conversations(profile_id,cycle_id,updated_at DESC);
CREATE TABLE ai_vision_permissions (
 cycle_id uuid PRIMARY KEY REFERENCES cycles(id) ON DELETE CASCADE,
 allow_write boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_vision_edits (
 id uuid PRIMARY KEY, cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 profile_id uuid NOT NULL REFERENCES profiles(id), conversation_id uuid REFERENCES ai_conversations(id),
 actor text NOT NULL, before_text text NOT NULL, after_text text NOT NULL,
 from_version integer NOT NULL, to_version integer NOT NULL,
 undone_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_vision_edits_cycle_idx ON ai_vision_edits(cycle_id,created_at DESC);
CREATE TABLE ai_oauth_clients (
 id text PRIMARY KEY, name text NOT NULL, redirect_uris jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_oauth_codes (
 code_hash text PRIMARY KEY, client_id text NOT NULL REFERENCES ai_oauth_clients(id),
 profile_id uuid NOT NULL REFERENCES profiles(id), cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 redirect_uri text NOT NULL, challenge text NOT NULL, scope text NOT NULL,
 resource text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE ai_oauth_tokens (
 token_hash text PRIMARY KEY, refresh_hash text UNIQUE NOT NULL,
 profile_id uuid NOT NULL REFERENCES profiles(id), cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 client_id text NOT NULL REFERENCES ai_oauth_clients(id), scope text NOT NULL,
 resource text NOT NULL, expires_at timestamptz NOT NULL, refresh_expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
