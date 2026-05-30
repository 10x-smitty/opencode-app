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

type LocalTestDataFile = {
  file: string;
  type: "json" | "html_worksheet_text";
  data: unknown;
};

export type ChartmetricArtistSearchResult = {
  id: string;
  name: string;
  imageUrl?: string | null;
  genres: string[];
  monthlyListeners?: number | null;
  careerStage?: string | null;
  socialHandle?: string | null;
};

const CALEB_ARTIST_ID = "caleb-lee-hutchinson";

let cachedToken: ChartmetricToken | null = null;
const responseCache = new Map<string, { expiresAt: number; data: unknown }>();

const CHARTMETRIC_BASE_URL = "https://api.chartmetric.com";
const RESPONSE_CACHE_TTL_MS = 15 * 60 * 1000;
const LOCAL_TEST_DATA_CACHE_TTL_MS = 60 * 1000;
const CHARTMETRIC_RETRY_DELAYS_MS = [750, 1500, 2500];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function extractPayload(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return record.obj ?? record.data ?? record;
}

function asLatestRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function compactValue(value: unknown, key?: string) {
  if (typeof value === "number") return new Intl.NumberFormat("en-US").format(value);
  if (typeof value !== "string") return String(value ?? "");

  const trimmed = value.trim();
  if (!trimmed) return "";
  if (key && ["percent", "weight", "engagement_rate"].includes(key)) return `${trimmed}%`;
  if (key === "affinity") return `${trimmed}x`;
  return trimmed;
}

function rowName(row: Record<string, unknown>) {
  return (
    compactValue(row.name) ||
    compactValue(row.fullname) ||
    compactValue(row.username) ||
    compactValue(row.code) ||
    "Unknown"
  );
}

function summarizeRows(
  label: string,
  rows: Record<string, unknown>[],
  metricKeys: string[],
  limit = 5,
) {
  if (!rows.length) return "";

  const rendered = rows.slice(0, limit).map((row) => {
    const metrics = metricKeys
      .map((key) => {
        const value = compactValue(row[key], key);
        return value ? `${key.replaceAll("_", " ")} ${value}` : "";
      })
      .filter(Boolean);
    return metrics.length ? `${rowName(row)} (${metrics.join(", ")})` : rowName(row);
  });

  return `- ${label}: ${rendered.join("; ")}`;
}

function summarizeScalar(label: string, value: unknown, key?: string) {
  const formatted = compactValue(value, key);
  return formatted && formatted !== "undefined" && formatted !== "null"
    ? `- ${label}: ${formatted}`
    : "";
}

function platformNameFromFile(file: string) {
  if (file.includes("instagram")) return "Instagram";
  if (file.includes("tiktok")) return "TikTok";
  if (file.includes("youtube")) return "YouTube";
  if (file.includes("worksheet")) return "Worksheet";
  if (file.includes("audience")) return titleFromLabel(file.replace("_audience", ""));
  return file.replaceAll("_", " ");
}

function titleFromLabel(label: string) {
  return label.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeAudiencePayload(file: string, value: unknown) {
  const payload = asRecord(extractPayload(value));
  const lines = [
    `### ${platformNameFromFile(file)}`,
    summarizeScalar("Followers", payload.followers),
    summarizeScalar("Subscribers", payload.subscribers),
    summarizeScalar("Average likes per post", payload.avg_likes_per_post),
    summarizeScalar("Average comments per post", payload.avg_commments_per_post),
    summarizeScalar("Engagement rate", payload.engagement_rate, "engagement_rate"),
    summarizeRows("Top countries", asArray(payload.top_countries), [
      "percent",
      "followers",
      "subscribers",
    ]),
    summarizeRows("Top cities", asArray(payload.top_cities), ["percent", "followers"]),
    summarizeRows("Active audience countries", asArray(payload.likers_top_countries), [
      "percent",
      "likes",
    ]),
    summarizeRows("Active audience cities", asArray(payload.likers_top_cities), ["percent", "likes"]),
    summarizeRows("Commenter countries", asArray(payload.commenters_top_countries), [
      "percent",
      "commenters",
      "subscribers",
    ]),
    summarizeRows("Audience gender split", asArray(payload.audience_genders), ["weight"]),
    summarizeRows("Active audience gender split", asArray(payload.audience_likers_genders), [
      "weight",
    ]),
    summarizeRows("Commenter gender split", asArray(payload.commenters_genders), ["weight"]),
    summarizeRows("Top audience interests", asArray(payload.audience_interests), [
      "weight",
      "affinity",
    ]),
    summarizeRows("Top active audience interests", asArray(payload.audience_likers_interests), [
      "weight",
      "affinity",
    ]),
    summarizeRows("Top brand affinities", asArray(payload.audience_brand_affinities), [
      "weight",
      "affinity",
    ]),
    summarizeRows("Top active audience brand affinities", asArray(payload.audience_likers_brand_affinities), [
      "weight",
      "affinity",
    ]),
    summarizeRows("Notable followers", asArray(payload.notable_followers), [
      "followers",
      "engagements",
    ]),
    summarizeRows("Notable subscribers", asArray(payload.notable_subscribers), [
      "subscribers",
      "followers",
    ]),
  ].filter(Boolean);

  return lines.join("\n");
}

function summarizeLoadedTestData(dataDir: string, loaded: LocalTestDataFile[]) {
  const platformSignals = loaded
    .filter((item) => item.type === "json")
    .map((item) => summarizeAudiencePayload(item.file, item.data))
    .filter(Boolean)
    .join("\n\n");
  const worksheet = loaded.find((item) => item.type === "html_worksheet_text");

  return [
    "## Selected artist",
    "Caleb Lee Hutchinson",
    "",
    "## Data source status",
    "- Source: local Caleb test data package.",
    "- Live Chartmetric credentials are not configured for this response.",
    "- Do not describe this data as live Chartmetric or OAuth-connected account data.",
    `- Local test data directory: ${dataDir}`,
    `- Loaded at: ${new Date().toISOString()}`,
    "",
    "## Platform-specific signals",
    platformSignals || "- No structured platform signals were parsed.",
    "",
    "## Unavailable / failed endpoints",
    "- Live Chartmetric API data is unavailable in this environment until CHARTMETRIC_REFRESH_TOKEN and CHARTMETRIC_ARTIST_ID are configured.",
    "- OAuth-connected Spotify, Instagram, TikTok, YouTube, merch, email, ticketing, and revenue data are unavailable unless present above or provided by the user.",
    "",
    "## Raw supporting data excerpt",
    worksheet
      ? `Worksheet excerpt: ${String(worksheet.data).slice(0, 3_000)}`
      : "No worksheet excerpt is available. Use only the structured platform-specific signals above.",
  ].join("\n");
}

function summarizeLiveEndpoint(endpoint: ChartmetricEndpointResult) {
  if (!endpoint.ok) return "";

  if (endpoint.label === "artist_profile") {
    const profile = asRecord(endpoint.data);
    return [
      "### Artist profile",
      summarizeScalar("Name", profile.name),
      summarizeScalar("Chartmetric artist ID", profile.id ?? profile.cm_artist),
      summarizeScalar("Country", profile.country),
      summarizeScalar("Hometown/city", profile.city ?? profile.hometown),
      summarizeScalar("Genres", Array.isArray(profile.genres) ? profile.genres.join(", ") : profile.genres),
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (endpoint.label === "artist_tracks") {
    const tracks = Array.isArray(endpoint.data) ? asArray(endpoint.data) : asArray(asRecord(endpoint.data).tracks);
    return [
      "### Tracks",
      summarizeRows("Top returned tracks", tracks, ["release_date", "isrc", "score"], 10) ||
        "- Tracks endpoint returned data, but no recognizable track list fields were parsed.",
    ].join("\n");
  }

  if (endpoint.label === "artist_albums") {
    const albums = Array.isArray(endpoint.data) ? asArray(endpoint.data) : asArray(asRecord(endpoint.data).albums);
    return [
      "### Albums",
      summarizeRows("Top returned albums", albums, ["release_date", "album_type"], 10) ||
        "- Albums endpoint returned data, but no recognizable album list fields were parsed.",
    ].join("\n");
  }

  if (endpoint.label === "similar_artists") {
    const similar = Array.isArray(endpoint.data)
      ? asArray(endpoint.data)
      : asArray(asRecord(endpoint.data).artists);
    return [
      "### Similar artists",
      summarizeRows("Similar artists", similar, ["score", "rank"], 10) ||
        "- Similar artists endpoint returned data, but no recognizable artist list fields were parsed.",
    ].join("\n");
  }

  if (endpoint.label.endsWith("_audience")) {
    return summarizeAudiencePayload(endpoint.label, endpoint.data);
  }

  if (endpoint.label.endsWith("_stats")) {
    const stats = asRecord(endpoint.data);
    return [
      `### ${titleFromLabel(endpoint.label)}`,
      ...Object.entries(stats)
        .slice(0, 16)
        .map(([key, value]) => summarizeScalar(key.replaceAll("_", " "), value)),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `### ${endpoint.label}`,
    "Endpoint returned data. Use the excerpt only for fields explicitly shown.",
    truncateJson(endpoint.data, 2_000),
  ].join("\n");
}

function summarizeLiveChartmetricContext(
  chartmetricArtistId: string,
  artistNameHint: string | undefined,
  endpoints: ChartmetricEndpointResult[],
) {
  const successful = endpoints.filter((endpoint) => endpoint.ok);
  const failed = endpoints.filter((endpoint) => !endpoint.ok);
  const summaries = successful.map(summarizeLiveEndpoint).filter(Boolean).join("\n\n");

  return [
    "## Selected artist",
    artistNameHint || `Chartmetric artist ${chartmetricArtistId}`,
    "",
    "## Data source status",
    "- Source: live Chartmetric API.",
    `- Chartmetric artist ID: ${chartmetricArtistId}`,
    `- Fetched at: ${new Date().toISOString()}`,
    "",
    "## Platform-specific signals",
    summaries || "- Chartmetric endpoints returned no parsed platform signals.",
    "",
    "## Unavailable / failed endpoints",
    failed.length
      ? failed
          .map((endpoint) => `- ${endpoint.label} (${endpoint.path}): ${endpoint.error}`)
          .join("\n")
      : "- No configured Chartmetric endpoints failed.",
    "- OAuth-connected Spotify, Instagram, TikTok, YouTube, merch, email, ticketing, and revenue data are unavailable unless present above or provided by the user.",
    "",
    "## Raw supporting data excerpt",
    successful.length
      ? truncateJson(
          successful.map((endpoint) => ({
            label: endpoint.label,
            path: endpoint.path,
            data: endpoint.data,
          })),
          6_000,
        )
      : "No raw data excerpt is available because no Chartmetric endpoint succeeded.",
  ].join("\n");
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
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < CHARTMETRIC_RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await fetch(`${CHARTMETRIC_BASE_URL}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      responseCache.set(path, {
        data,
        expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
      });

      return data;
    }

    lastStatus = response.status;
    lastBody = await response.text().catch(() => "");

    if (response.status !== 429 || attempt === CHARTMETRIC_RETRY_DELAYS_MS.length - 1) {
      break;
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    await wait(Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : CHARTMETRIC_RETRY_DELAYS_MS[attempt]);
  }

  throw new Error(
    `Chartmetric request failed for ${path}: ${lastStatus}${lastBody ? ` ${lastBody.slice(0, 120)}` : ""}`,
  );
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

function extractGenreNames(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asRecord(item);
      return compactValue(record.name || record.genre || record.title);
    })
    .filter(Boolean);
}

export type ChartmetricArtistProfile = {
  id: string;
  name: string;
  imageUrl: string | null;
  bio: string | null;
  hometown: string | null;
  country: string | null;
  genres: string[];
  subgenres: string[];
  socialHandle: string | null;
  stats: {
    spotify: number | null;
    instagram: number | null;
    tiktok: number | null;
    youtube: number | null;
  };
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickFirstNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

// Handles the three shapes Chartmetric stat endpoints can return for a metric:
//   1. flat:  { followers: 12345 }
//   2. timeseries array: { followers: [{ value: 12345, timestp: "..." }] }
//   3. wrapped object:  { followers: { value: 12345 } }
function extractStatValue(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (raw == null) continue;

    const direct = toFiniteNumber(raw);
    if (direct !== null) return direct;

    if (Array.isArray(raw) && raw.length) {
      const first = raw[0];
      const fromArrayDirect = toFiniteNumber(first);
      if (fromArrayDirect !== null) return fromArrayDirect;
      if (first && typeof first === "object") {
        const nested = toFiniteNumber((first as Record<string, unknown>).value);
        if (nested !== null) return nested;
      }
      continue;
    }

    if (typeof raw === "object") {
      const nested = toFiniteNumber((raw as Record<string, unknown>).value);
      if (nested !== null) return nested;
    }
  }

  return null;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const trimmed = compactValue(record[key]);
    if (trimmed) return trimmed;
  }
  return null;
}

function extractNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return compactValue((item as Record<string, unknown>).name);
      }
      return "";
    })
    .filter((item): item is string => Boolean(item));
}

function extractMarketCount(audience: unknown): number | null {
  // The endpoint may return either { cities, countries } or a bare array
  // depending on the Chartmetric variant — handle both.
  const root = Array.isArray(audience) ? { cities: audience } : asRecord(audience);

  const countryCandidates = asArray(root.audience_by_country ?? root.countries);
  if (countryCandidates.length) {
    const unique = new Set(
      countryCandidates
        .map((entry) =>
          pickFirstString(entry, ["country", "country_name", "code2", "code", "name"]),
        )
        .filter((value): value is string => Boolean(value)),
    );
    if (unique.size) return unique.size;
  }

  const cityCandidates = asArray(root.audience_by_city ?? root.cities ?? root.data);
  if (cityCandidates.length) {
    const unique = new Set(
      cityCandidates
        .map((entry) => pickFirstString(entry, ["country", "country_name", "code2", "code"]))
        .filter((value): value is string => Boolean(value)),
    );
    if (unique.size) return unique.size;
  }

  return null;
}

export async function fetchChartmetricArtistProfile(
  artistId: string,
): Promise<ChartmetricArtistProfile> {
  const encoded = encodeURIComponent(artistId);
  const profilePayload = asRecord(extractPayload(await chartmetricGet(`/api/artist/${encoded}`)));
  if (process.env.CHARTMETRIC_DEBUG === "1") {
    console.log(
      `[chartmetric] profile keys for ${artistId}:`,
      Object.keys(profilePayload),
      "cm_statistics:",
      JSON.stringify(profilePayload.cm_statistics).slice(0, 400),
    );
  }
  async function fetchStatRecord(source: string) {
    try {
      const payload = await chartmetricGet(`/api/artist/${encoded}/stat/${source}?latest=true`);
      return asLatestRecord(extractPayload(payload));
    } catch (error) {
      console.warn(`[chartmetric] ${source} stats fetch failed for ${artistId}:`, error);
      return {} as Record<string, unknown>;
    }
  }

  const [spotifyRecord, instagramRecord, tiktokRecord, youtubeRecord] = await Promise.all([
    fetchStatRecord("spotify"),
    fetchStatRecord("instagram"),
    fetchStatRecord("tiktok"),
    fetchStatRecord("youtube_channel"),
  ]);

  if (process.env.CHARTMETRIC_DEBUG === "1") {
    console.log(
      `[chartmetric] platform stat keys for ${artistId}:`,
      JSON.stringify({
        spotify: Object.keys(spotifyRecord),
        instagram: Object.keys(instagramRecord),
        tiktok: Object.keys(tiktokRecord),
        youtube: Object.keys(youtubeRecord),
      }),
    );
  }

  const cmStatistics = asRecord(profilePayload.cm_statistics);

  const genres = extractNameList(profilePayload.genres);
  const subgenres = [
    ...extractNameList(profilePayload.subgenres),
    ...extractNameList(profilePayload.sub_genres),
    ...extractNameList(profilePayload.tags),
  ];
  const uniqueSubgenres = Array.from(
    new Set(subgenres.filter((entry) => !genres.includes(entry))),
  );

  return {
    id: artistId,
    name: pickFirstString(profilePayload, ["name", "artist_name"]) ?? "",
    imageUrl: pickFirstString(profilePayload, [
      "image_url",
      "spotify_image_url",
      "image_url_lg",
    ]),
    bio: pickFirstString(profilePayload, ["description", "bio", "summary"]),
    hometown: pickFirstString(profilePayload, ["hometown", "city"]),
    country: pickFirstString(profilePayload, ["country", "code2", "country_code"]),
    genres,
    subgenres: uniqueSubgenres,
    socialHandle: extractSocialHandle(profilePayload),
    stats: {
      spotify:
        extractStatValue(spotifyRecord, [
          "listeners",
          "monthly_listeners",
          "sp_monthly_listeners",
        ]) ??
        extractStatValue(cmStatistics, [
          "sp_monthly_listeners",
          "spotify_monthly_listeners",
          "monthly_listeners",
        ]) ??
        extractStatValue(profilePayload, [
          "sp_monthly_listeners",
          "spotify_monthly_listeners",
          "monthly_listeners",
        ]),
      instagram:
        extractStatValue(instagramRecord, ["followers", "ig_followers", "instagram_followers"]) ??
        extractStatValue(cmStatistics, ["ig_followers", "instagram_followers"]) ??
        extractStatValue(profilePayload, ["ig_followers", "instagram_followers"]),
      tiktok:
        extractStatValue(tiktokRecord, ["followers", "tt_followers", "tiktok_followers"]) ??
        extractStatValue(cmStatistics, ["tt_followers", "tiktok_followers"]) ??
        extractStatValue(profilePayload, ["tt_followers", "tiktok_followers"]),
      youtube:
        extractStatValue(youtubeRecord, [
          "subscribers",
          "subscriber_count",
          "ycs_subscribers",
          "youtube_subscribers",
        ]) ??
        extractStatValue(cmStatistics, [
          "ycs_subscribers",
          "ycg_subscribers",
          "youtube_subscribers",
        ]) ??
        extractStatValue(profilePayload, [
          "ycs_subscribers",
          "ycg_subscribers",
          "youtube_subscribers",
        ]),
    },
  };
}

export async function searchChartmetricArtists(query: string, limit = 10) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    type: "artists",
    limit: String(limit),
  });
  const payload = extractPayload(await chartmetricGet(`/api/search?${params}`));
  const response = asRecord(payload);
  const artists = Array.isArray(payload)
    ? asArray(payload)
    : asArray(response.artists ?? response.results);

  return artists.slice(0, limit).flatMap((artist): ChartmetricArtistSearchResult[] => {
    const rawId = artist.id ?? artist.cm_artist ?? artist.cm_artist_id;
    const id = rawId === undefined || rawId === null ? "" : String(rawId);
    const name = compactValue(artist.name ?? artist.artist_name);
    if (!id || !name) return [];

    const monthlyListeners =
      typeof artist.sp_monthly_listeners === "number"
        ? artist.sp_monthly_listeners
        : typeof artist.spotify_monthly_listeners === "number"
          ? artist.spotify_monthly_listeners
          : null;

    return [
      {
        id,
        name,
        imageUrl: compactValue(artist.image_url ?? artist.spotify_image_url) || null,
        genres: extractGenreNames(artist.genres),
        monthlyListeners,
        careerStage: compactValue(artist.career_stage) || null,
        socialHandle: extractSocialHandle(artist),
      },
    ];
  });
}

function normalizeSocialHandle(value: string) {
  const trimmed = value.replace(/^@+/, "").trim().replace(/\/+$/, "");
  return trimmed || null;
}

function parseHandleFromUrl(url: string) {
  const match = url.match(/(?:instagram|tiktok|twitter|x)\.com\/@?([^\s/?#]+)/i);
  if (!match) return null;
  return normalizeSocialHandle(match[1]);
}

function extractSocialHandle(artist: Record<string, unknown>): string | null {
  const usernameKeys = [
    "instagram_username",
    "ig_username",
    "tiktok_username",
    "tt_username",
    "twitter_username",
    "x_username",
  ];
  for (const key of usernameKeys) {
    const raw = compactValue(artist[key]);
    if (raw) {
      const handle = normalizeSocialHandle(raw);
      if (handle) return handle;
    }
  }

  const urlKeys = ["instagram_url", "ig_url", "tiktok_url", "tt_url", "twitter_url", "x_url"];
  for (const key of urlKeys) {
    const raw = compactValue(artist[key]);
    if (!raw) continue;
    const handle = parseHandleFromUrl(raw);
    if (handle) return handle;
  }

  if (Array.isArray(artist.domains)) {
    for (const entry of artist.domains) {
      if (!entry || typeof entry !== "object") continue;
      const domain = entry as Record<string, unknown>;
      const platform = String(domain.domain ?? domain.platform ?? "").toLowerCase();
      if (!["instagram", "tiktok", "twitter", "x"].includes(platform)) continue;

      const direct = compactValue(domain.handle ?? domain.username ?? domain.name);
      if (direct) {
        const handle = normalizeSocialHandle(direct);
        if (handle) return handle;
      }

      const urlValue = compactValue(domain.url);
      if (urlValue) {
        const handle = parseHandleFromUrl(urlValue);
        if (handle) return handle;
      }
    }
  }

  return null;
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
      "## Selected artist",
      artistId,
      "",
      "## Data source status",
      "- No local test data package is configured for this artist.",
      "- Live Chartmetric credentials are not configured for this response.",
      "",
      "## Platform-specific signals",
      "- No platform metrics are available for this selected artist.",
      "",
      "## Unavailable / failed endpoints",
      "- Caleb Lee Hutchinson is the only bundled local test-data artist.",
      "- OAuth-connected Spotify, Instagram, TikTok, YouTube, merch, email, ticketing, and revenue data are unavailable unless the user provides them.",
      "",
      "## Raw supporting data excerpt",
      "No raw data excerpt is available for this artist.",
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

  const loaded: LocalTestDataFile[] = await Promise.all(
    CALEB_TEST_DATA_FILES.map(async (file) => {
      const raw = await readFile(path.join(/* turbopackIgnore: true */ dataDir, file), "utf8");
      if (file.toLowerCase().endsWith(".json")) {
        return {
          file,
          type: "json" as const,
          data: JSON.parse(raw),
        };
      }

      return {
        file,
        type: "html_worksheet_text" as const,
        data: stripHtml(raw).slice(0, 12_000),
      };
    }),
  ).catch(() => [] as LocalTestDataFile[]);

  if (!loaded.length) return null;

  const context = summarizeLoadedTestData(dataDir, loaded);

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

export async function getChartmetricArtistContext(selectedArtistId?: string, selectedArtistName?: string) {
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

  const chartmetricArtistId = String(
    selectedArtistId && selectedArtistId !== CALEB_ARTIST_ID
      ? selectedArtistId
      : env.chartmetricArtistId,
  );
  const encodedChartmetricArtistId = encodeURIComponent(chartmetricArtistId);
  const artistNameHint =
    selectedArtistName ||
    (chartmetricArtistId === env.chartmetricArtistId ? env.chartmetricArtistName : undefined);
  const endpointSpecs = [
    ["artist_profile", `/api/artist/${encodedChartmetricArtistId}`],
    ["spotify_stats", `/api/artist/${encodedChartmetricArtistId}/stat/spotify?latest=true`],
    ["instagram_stats", `/api/artist/${encodedChartmetricArtistId}/stat/instagram?latest=true`],
    ["youtube_stats", `/api/artist/${encodedChartmetricArtistId}/stat/youtube_channel?latest=true`],
    ["tiktok_stats", `/api/artist/${encodedChartmetricArtistId}/stat/tiktok?latest=true`],
    ["instagram_audience", `/api/artist/${encodedChartmetricArtistId}/instagram-audience-stats`],
    ["youtube_audience", `/api/artist/${encodedChartmetricArtistId}/youtube-audience-stats`],
    ["tiktok_audience", `/api/artist/${encodedChartmetricArtistId}/tiktok-audience-stats`],
    ["artist_tracks", `/api/artist/${encodedChartmetricArtistId}/tracks?limit=25&offset=0`],
    ["artist_albums", `/api/artist/${encodedChartmetricArtistId}/albums`],
    ["similar_artists", `/api/artist/${encodedChartmetricArtistId}/similar-artists`],
  ] as const;
  const endpoints: ChartmetricEndpointResult[] = [];

  for (const [label, endpointPath] of endpointSpecs) {
    endpoints.push(await fetchEndpoint(label, endpointPath));
    await wait(150);
  }

  return summarizeLiveChartmetricContext(chartmetricArtistId, artistNameHint, endpoints);
}
