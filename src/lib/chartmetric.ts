import { getEnv } from "./env";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

type ChartmetricToken = {
  token: string;
  expiresAt: number;
};

type ChartmetricEndpointResult = {
  label: string;
  path: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

const CALEB_ARTIST_ID = "caleb-lee-hutchinson";

let cachedToken: ChartmetricToken | null = null;
const responseCache = new Map<string, { expiresAt: number; data: unknown }>();

const CHARTMETRIC_BASE_URL = "https://api.chartmetric.com";
const RESPONSE_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCAL_TEST_DATA_CACHE_TTL_MS = 60 * 1000;
const CALEB_TEST_DATA_FILES = [
  "caleb_data_worksheet.html",
  "caleb_instagram_audience.json",
  "caleb_tiktok_audience.json",
  "caleb_youtube_audience.json",
];

let cachedLocalTestData: { dir: string; expiresAt: number; context: string } | null = null;

function truncateJson(value: unknown, maxLength = 18_000) {
  const json = JSON.stringify(value, null, 2);
  if (json.length <= maxLength) return json;

  return `${json.slice(0, maxLength)}\n...truncated...`;
}

function extractPayload(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return record.obj ?? record.data ?? record;
}

async function getAccessToken() {
  const refreshToken = getEnv().chartmetricRefreshToken;
  if (!refreshToken) {
    throw new Error("CHARTMETRIC_REFRESH_TOKEN is not configured");
  }

  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const response = await fetch(`${CHARTMETRIC_BASE_URL}/api/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ refreshtoken: refreshToken }),
  });

  if (!response.ok) {
    throw new Error(`Chartmetric token request failed: ${response.status}`);
  }

  const data = (await response.json()) as { token?: string; expires_in?: number };
  if (!data.token) throw new Error("Chartmetric token response did not include a token");

  cachedToken = {
    token: data.token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  return cachedToken.token;
}

async function chartmetricGet(path: string) {
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const token = await getAccessToken();
  const response = await fetch(`${CHARTMETRIC_BASE_URL}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Chartmetric request failed for ${path}: ${response.status}`);
  }

  const data = await response.json();
  responseCache.set(path, {
    data,
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
  });

  return data;
}

async function fetchEndpoint(label: string, path: string): Promise<ChartmetricEndpointResult> {
  try {
    return {
      label,
      path,
      ok: true,
      data: extractPayload(await chartmetricGet(path)),
    };
  } catch (error) {
    return {
      label,
      path,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown Chartmetric error",
    };
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultTestDataDir() {
  return path.join(process.cwd(), "test-data", "chartmetric-caleb");
}

function resolveTestDataDir() {
  const env = getEnv();
  const candidates = [env.chartmetricTestDataDir, defaultTestDataDir()].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? defaultTestDataDir();
}

async function loadLocalTestDataContext(artistId?: string) {
  if (artistId && artistId !== CALEB_ARTIST_ID) {
    return [
      `No local test data package is configured for artist "${artistId}".`,
      "Select Caleb Lee Hutchinson to use the bundled Caleb test data, or connect this artist to Chartmetric data before making data-backed recommendations.",
    ].join("\n");
  }

  const dataDir = resolveTestDataDir();

  if (!existsSync(dataDir)) return null;
  if (
    cachedLocalTestData &&
    cachedLocalTestData.dir === dataDir &&
    cachedLocalTestData.expiresAt > Date.now()
  ) {
    return cachedLocalTestData.context;
  }

  const files = CALEB_TEST_DATA_FILES.filter((file) => existsSync(path.join(dataDir, file)));
  if (!files.length) return null;

  const loaded = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(path.join(/* turbopackIgnore: true */ dataDir, file), "utf8");
      if (file.toLowerCase().endsWith(".json")) {
        return {
          file,
          type: "json",
          data: JSON.parse(raw),
        };
      }

      return {
        file,
        type: "html_worksheet_text",
        data: stripHtml(raw).slice(0, 12_000),
      };
    }),
  );

  const context = [
    "Live Chartmetric credentials are not configured. Use this local Caleb test data package instead.",
    "Treat this as test artist data for Caleb Lee Hutchinson. Do not claim it was fetched live from Chartmetric.",
    "Do not invent missing connector data. If a metric is not in these files, say it is not present in the test package.",
    `Local test data directory: ${dataDir}`,
    `Loaded at: ${new Date().toISOString()}`,
    "",
    truncateJson(loaded, 28_000),
  ].join("\n");

  cachedLocalTestData = {
    dir: dataDir,
    context,
    expiresAt: Date.now() + LOCAL_TEST_DATA_CACHE_TTL_MS,
  };

  return context;
}

export function getChartmetricConfigStatus() {
  const env = getEnv();
  const dataDir = resolveTestDataDir();
  return {
    configured: Boolean(env.chartmetricRefreshToken && env.chartmetricArtistId),
    artistId: env.chartmetricArtistId ?? null,
    artistName: env.chartmetricArtistName ?? null,
    testDataConfigured: existsSync(dataDir),
    testDataDir: existsSync(dataDir) ? dataDir : null,
  };
}

export async function getChartmetricArtistContext(selectedArtistId?: string) {
  const env = getEnv();

  if (!env.chartmetricRefreshToken || !env.chartmetricArtistId) {
    const localTestDataContext = await loadLocalTestDataContext(selectedArtistId);
    if (localTestDataContext) return localTestDataContext;

    return [
      "Chartmetric is not configured for this Ask Artie instance.",
      "Set CHARTMETRIC_REFRESH_TOKEN and CHARTMETRIC_ARTIST_ID on the server to enable live Chartmetric data.",
      env.chartmetricArtistName ? `Configured artist name hint: ${env.chartmetricArtistName}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const chartmetricArtistId = encodeURIComponent(env.chartmetricArtistId);
  const endpoints = await Promise.all([
    fetchEndpoint("artist_profile", `/api/artist/${chartmetricArtistId}`),
    fetchEndpoint("artist_tracks", `/api/artist/${chartmetricArtistId}/tracks?limit=25&offset=0`),
    fetchEndpoint("artist_albums", `/api/artist/${chartmetricArtistId}/albums`),
    fetchEndpoint("similar_artists", `/api/artist/${chartmetricArtistId}/similar-artists`),
    fetchEndpoint("spotify_stats", `/api/artist/${chartmetricArtistId}/stat/spotify?latest=true`),
  ]);

  const successful = endpoints.filter((endpoint) => endpoint.ok);
  const failed = endpoints.filter((endpoint) => !endpoint.ok);

  return [
    "Use the following live Chartmetric data as the source of truth for this response.",
    "Do not invent unavailable connector data. If a metric is missing, say it is missing.",
    env.chartmetricArtistName ? `Configured artist name: ${env.chartmetricArtistName}` : "",
    `Configured Chartmetric artist ID: ${env.chartmetricArtistId}`,
    `Fetched at: ${new Date().toISOString()}`,
    "",
    "Successful Chartmetric endpoints:",
    truncateJson(
      successful.map((endpoint) => ({
        label: endpoint.label,
        path: endpoint.path,
        data: endpoint.data,
      })),
    ),
    failed.length
      ? [
          "",
          "Unavailable Chartmetric endpoints. Do not rely on these fields:",
          truncateJson(
            failed.map((endpoint) => ({
              label: endpoint.label,
              path: endpoint.path,
              error: endpoint.error,
            })),
          ),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
