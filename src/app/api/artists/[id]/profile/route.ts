import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { fetchChartmetricArtistProfile } from "@/lib/chartmetric";
import { summarizeArtistBio } from "@/lib/bio-summary";
import { getPool } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const trimmed = id?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Artist id is required" }, { status: 400 });
    }

    const pool = getPool();
    const profile = await fetchChartmetricArtistProfile(trimmed);

    const stored = await pool.query<{ bio: string | null }>(
      `select bio from user_artists where user_id = $1 and chartmetric_artist_id = $2`,
      [user.id, trimmed],
    );
    const storedBio = stored.rows[0]?.bio ?? null;

    if (storedBio) {
      profile.bio = storedBio;
    } else if (profile.bio) {
      const summary = await summarizeArtistBio(profile.name || trimmed, profile.bio);
      if (summary) {
        profile.bio = summary;
        await pool.query(
          `update user_artists set bio = $1 where user_id = $2 and chartmetric_artist_id = $3`,
          [summary, user.id, trimmed],
        );
      }
    }

    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artist profile request failed" },
      { status: 500 },
    );
  }
}
