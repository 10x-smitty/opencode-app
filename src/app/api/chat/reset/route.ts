import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";
import { createOpencodeSession } from "@/lib/opencode";

type ResetRequest = {
  artistId?: string;
  artistName?: string;
};

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const body = (await request.json().catch(() => ({}))) as ResetRequest;
    const artistId = body.artistId?.trim() || null;
    const artistName = body.artistName?.trim() || null;

    const opencodeSessionId = await createOpencodeSession("New chat");
    const created = await pool.query(
      `insert into chat_sessions (user_id, title, artist_id, artist_name, opencode_session_id)
       values ($1, 'New chat', $2, $3, $4)
       returning id, title, artist_id, artist_name, created_at`,
      [user.id, artistId, artistName, opencodeSessionId],
    );

    return NextResponse.json({ session: created.rows[0] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Could not start a new chat" }, { status: 500 });
  }
}
