import type { ChartmetricArtistSearchResult } from "./chartmetric";
import { randomUUID } from "node:crypto";

const SEARCH_TOKEN_TTL_MS = 10 * 60 * 1000;

type CachedArtistResult = ChartmetricArtistSearchResult & {
  expiresAt: number;
};

const globalForArtistSearch = globalThis as typeof globalThis & {
  artistSearchCache?: Map<string, CachedArtistResult>;
};

function getCache() {
  globalForArtistSearch.artistSearchCache ??= new Map<string, CachedArtistResult>();
  return globalForArtistSearch.artistSearchCache;
}

function purgeExpired(cache: Map<string, CachedArtistResult>) {
  const now = Date.now();
  for (const [token, result] of cache.entries()) {
    if (result.expiresAt <= now) cache.delete(token);
  }
}

export function cacheArtistSearchResult(result: ChartmetricArtistSearchResult) {
  const cache = getCache();
  purgeExpired(cache);

  const token = randomUUID();
  cache.set(token, {
    ...result,
    expiresAt: Date.now() + SEARCH_TOKEN_TTL_MS,
  });

  return token;
}

export function consumeArtistSearchResult(token: string) {
  const cache = getCache();
  purgeExpired(cache);

  const result = cache.get(token);
  if (!result) return null;

  cache.delete(token);
  const { expiresAt: _expiresAt, ...artist } = result;
  return artist;
}
