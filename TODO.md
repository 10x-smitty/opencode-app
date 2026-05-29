# TODO

## Before shipping to production

### Rotate all demo secrets in `.env`

`.env` currently ships with publicly-known demo values copied from `.env.example`.
On a host reachable from the internet (or shared network), these would let anyone
sign in as service_role, read/write the database, or log into Supabase Studio.

Rotate before exposing the stack on anything other than `localhost`:

- [ ] `POSTGRES_PASSWORD` — replace `postgres` with a strong random value
      (`openssl rand -hex 32`)
- [ ] `JWT_SECRET` — replace the demo string (`openssl rand -hex 32`)
- [ ] `ANON_KEY` and `SERVICE_ROLE_KEY` — re-sign with the new `JWT_SECRET`
      (Supabase docs: https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys)
- [ ] `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — change from `supabase` / `this_password_is_insecure_and_should_be_updated`
- [ ] `S3_PROTOCOL_ACCESS_KEY_ID` / `S3_PROTOCOL_ACCESS_KEY_SECRET` — rotate
- [ ] `LOGFLARE_PUBLIC_ACCESS_TOKEN` / `LOGFLARE_PRIVATE_ACCESS_TOKEN` — rotate
- [ ] `SUPABASE_PUBLIC_URL` and `API_EXTERNAL_URL` — point at the real public origin
      (not `http://localhost:8000`) so browser-side auth uses the correct origin
- [ ] Confirm `.env` is not committed to git and is provisioned out-of-band
      (secrets manager, CI variables, etc.)
- [ ] Confirm `OPENCODE_SERVER_PASSWORD` is set (currently unsecured per the
      opencode-service startup log: "Warning: OPENCODE_SERVER_PASSWORD is not set;
      server is unsecured.")
