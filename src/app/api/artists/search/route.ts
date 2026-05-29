import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { cacheArtistSearchResult } from "@/lib/artist-search-cache";
import { searchChartmetricArtists } from "@/lib/chartmetric";

export async function GET(request: Request) {
  try {
    await requireUser(request);

    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";

    if (query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const results = (await searchChartmetricArtists(query, 10)).map((artist) => ({
      token: cacheArtistSearchResult(artist),
      name: artist.name,
      imageUrl: artist.imageUrl,
      genres: artist.genres,
      monthlyListeners: artist.monthlyListeners,
      careerStage: artist.careerStage,
      socialHandle: artist.socialHandle,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artist search failed" },
      { status: 500 },
    );
  }
}
