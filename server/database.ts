import { Pool } from 'pg'

export const db = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
}) : null
db?.on('error', () => console.error('PostgreSQL connection error'))

// Versioned, transactional migration. Lock also protects simultaneous starts.
export async function migrate(): Promise<void> {
  if (!db) return
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(81724601)')
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)')
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = 1')
    if (!exists.rowCount) {
      await client.query(`
        CREATE TABLE profiles (
          id uuid PRIMARY KEY,
          discord_id text UNIQUE NOT NULL,
          nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 32),
          avatar_url text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE auth_sessions (
          token_hash text PRIMARY KEY,
          profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          expires_at timestamptz NOT NULL
        );
        CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
        CREATE TABLE oauth_states (
          token_hash text PRIMARY KEY,
          expires_at timestamptz NOT NULL
        );
        CREATE TABLE matches (
          id uuid PRIMARY KEY,
          started_at timestamptz NOT NULL,
          finished_at timestamptz NOT NULL,
          player_count integer NOT NULL CHECK (player_count > 0),
          game_mode text NOT NULL
        );
        CREATE TABLE match_players (
          match_id uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
          profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          admitted boolean NOT NULL,
          elimination_order integer CHECK (elimination_order > 0),
          starting_traits jsonb NOT NULL,
          PRIMARY KEY (match_id, profile_id)
        );
        CREATE INDEX match_players_profile ON match_players(profile_id, match_id);
        INSERT INTO schema_migrations VALUES (1);
      `)
    }
    const second = await client.query('SELECT 1 FROM schema_migrations WHERE version = 2')
    if (!second.rowCount) {
      await client.query(`
        ALTER TABLE matches ADD COLUMN target_coef double precision;
        ALTER TABLE matches ADD COLUMN random_target_coef boolean;
        ALTER TABLE match_players ADD COLUMN starting_coef double precision;
        INSERT INTO schema_migrations VALUES (2);
      `)
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}
