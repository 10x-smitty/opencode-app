function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getEnv() {
  return {
    databaseUrl: requireEnv("DATABASE_URL"),
    jwtSecret: requireEnv("SUPABASE_JWT_SECRET"),
    jwtIssuer: process.env.SUPABASE_JWT_ISSUER,
    opencodeUrl: process.env.OPENCODE_URL ?? "http://opencode:4096",
    opencodeProviderId: process.env.OPENCODE_PROVIDER_ID,
    opencodeModelId: process.env.OPENCODE_MODEL_ID,
    opencodeAgent: process.env.OPENCODE_AGENT ?? "ask-artie",
    opencodeDirectory: process.env.OPENCODE_DIRECTORY ?? "/workspace",
    chartmetricRefreshToken: process.env.CHARTMETRIC_REFRESH_TOKEN,
    chartmetricArtistId: process.env.CHARTMETRIC_ARTIST_ID,
    chartmetricArtistName: process.env.CHARTMETRIC_ARTIST_NAME,
    chartmetricTestDataDir: process.env.CHARTMETRIC_TEST_DATA_DIR,
  };
}
