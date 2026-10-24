CREATE TABLE calendar_connections (
 profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
 username text NOT NULL,
 secret_cipher text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE calendar_previews (
 id uuid PRIMARY KEY,
 profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 payload jsonb NOT NULL,
 expires_at timestamptz NOT NULL,
 result jsonb
);
CREATE INDEX calendar_previews_owner ON calendar_previews(profile_id,cycle_id);
