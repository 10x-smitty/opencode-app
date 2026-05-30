import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { fetchChartmetricArtistProfile } from "@/lib/chartmetric";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    await requireUser(request);
    const { id } = await params;
    const trimmed = id?.trim();
    if (!trimmed) {
      return NextResponse.json({ error: "Artist id is required" }, { status: 400 });
    }

    const profile = await fetchChartmetricArtistProfile(trimmed);
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
