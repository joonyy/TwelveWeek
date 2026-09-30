CREATE TABLE IF NOT EXISTS profiles (
 id uuid PRIMARY KEY, name text NOT NULL, normalized_name text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY, profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_profile_idx ON sessions(profile_id);
CREATE TABLE IF NOT EXISTS cycles (
 id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES profiles(id),
 title text NOT NULL, start_date date NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','complete')),
 plan jsonb NOT NULL, version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cycles_profile_idx ON cycles(profile_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_cycle_per_profile ON cycles(profile_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS weeks (
 cycle_id uuid NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
 number integer NOT NULL CHECK(number BETWEEN 1 AND 12), state jsonb NOT NULL, version integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(cycle_id,number)
);
CREATE TABLE IF NOT EXISTS changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, profile_id uuid NOT NULL REFERENCES profiles(id), cycle_id uuid NOT NULL REFERENCES cycles(id),
 kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
