# Ask Artie OpenCode Chat

Chat-only Ask Artie application with:

- Next.js frontend and API routes on `http://localhost:3000`
- OpenCode service via `opencode serve` on `http://localhost:4096`
- Official Supabase self-hosted Docker stack behind Kong on `http://localhost:8000`
- Chat persistence in Postgres with RLS policies in `db/app/001_chat_schema.sql`
- Project-local OpenCode config in `opencode.jsonc` and `.opencode/`

## Run

```bash
cp .env.example .env
docker compose up -d --build
```

The first run pulls the full Supabase stack and can take several minutes.

## Local URLs

- Ask Artie chat app: `http://localhost:3000`
- Supabase API gateway and Studio: `http://localhost:8000`
- OpenCode API docs: `http://localhost:4096/doc`

Studio is protected by the credentials in `.env`:

- `DASHBOARD_USERNAME`
- `DASHBOARD_PASSWORD`

## AI Provider

By default the app uses the `ask-artie` OpenCode agent and the model configured
in `opencode.jsonc`:

```jsonc
{
  "model": "opencode/big-pickle",
  "default_agent": "ask-artie"
}
```

The chat UI does not expose model switching. Change the model in
`opencode.jsonc`, then recreate the OpenCode service when you want a different
default.

## Chartmetric Artist Data

Ask Artie can inject server-side Chartmetric context into every chat prompt. Set
these values in `.env`, then rebuild the client container:

```bash
CHARTMETRIC_REFRESH_TOKEN=...
CHARTMETRIC_ARTIST_ID=...
CHARTMETRIC_ARTIST_NAME=...
CHARTMETRIC_TEST_DATA_DIR=/workspace/test-data/chartmetric-caleb
```

The app exchanges `CHARTMETRIC_REFRESH_TOKEN` for a Chartmetric access token and
fetches artist profile, tracks, albums, similar artists, and latest Spotify
stats. If live Chartmetric credentials are blank and `CHARTMETRIC_TEST_DATA_DIR`
points to a local package, Ask Artie uses that package as test artist data. If
neither live credentials nor local test data are available, chat still works, but
Ask Artie will say that Chartmetric is not configured instead of inventing artist
metrics.
