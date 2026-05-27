import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { consumeArtistSearchResult } from "@/lib/artist-search-cache";
import { getChartmetricConfigStatus } from "@/lib/chartmetric";
import { getPool } from "@/lib/db";

type AddArtistRequest = {
  token?: string;
};

function rowToArtist(row: {
  chartmetric_artist_id: string;
  name: string;
  image_url?: string | null;
  genres?: string[] | null;
  is_default?: boolean;
}) {
  return {
    id: row.chartmetric_artist_id,
    name: row.name,
    dataLabel: "Live Chartmetric",
    imageUrl: row.image_url ?? null,
    genres: row.genres ?? [],
    isDefault: row.is_default ?? false,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const result = await pool.query(
      `select chartmetric_artist_id, name, image_url, genres
       from user_artists
       where user_id = $1
       order by created_at asc`,
      [user.id],
    );

    const artists = result.rows.map(rowToArtist);
    const status = getChartmetricConfigStatus();

    if (
      status.configured &&
      status.artistId &&
      status.artistName &&
      !artists.some((artist) => artist.id === status.artistId)
    ) {
      artists.unshift({
        id: status.artistId,
        name: status.artistName,
        dataLabel: "Live Chartmetric",
        imageUrl: null,
        genres: [],
        isDefault: true,
      });
    }

    return NextResponse.json({ artists });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artists request failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as AddArtistRequest;
    const token = body.token?.trim();

    if (!token) {
      return NextResponse.json({ error: "Artist search token is required" }, { status: 400 });
    }

    const artist = consumeArtistSearchResult(token);
    if (!artist) {
      return NextResponse.json(
        { error: "Artist search expired. Search again and select the artist." },
        { status: 400 },
      );
    }

    const pool = getPool();
    const result = await pool.query(
      `insert into user_artists
        (user_id, chartmetric_artist_id, name, image_url, genres, monthly_listeners, career_stage)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (user_id, chartmetric_artist_id) do update
       set name = excluded.name,
           image_url = excluded.image_url,
           genres = excluded.genres,
           monthly_listeners = excluded.monthly_listeners,
           career_stage = excluded.career_stage
       returning chartmetric_artist_id, name, image_url, genres`,
      [
        user.id,
        artist.id,
        artist.name,
        artist.imageUrl,
        artist.genres,
        artist.monthlyListeners,
        artist.careerStage,
      ],
    );

    return NextResponse.json({ artist: rowToArtist(result.rows[0]) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artist add request failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const artistId = url.searchParams.get("artistId")?.trim();

    if (!artistId) {
      return NextResponse.json({ error: "artistId is required" }, { status: 400 });
    }

    const pool = getPool();
    const result = await pool.query(
      `delete from user_artists
       where user_id = $1 and chartmetric_artist_id = $2
       returning chartmetric_artist_id`,
      [user.id, artistId],
    );

    if (!result.rows[0]) {
      return NextResponse.json(
        { error: "Artist not found or cannot be removed" },
        { status: 404 },
      );
    }

    return NextResponse.json({ deletedId: result.rows[0].chartmetric_artist_id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Artist delete request failed" },
      { status: 500 },
    );
  }
}
