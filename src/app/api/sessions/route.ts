import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const { rows } = await pool.query(
      `select id, title, artist_id, artist_name, created_at, pinned_at, archived_at
       from chat_sessions
       where user_id = $1
       order by
         (archived_at is not null) asc,
         (pinned_at is null) asc,
         pinned_at desc,
         created_at desc`,
      [user.id],
    );

    return NextResponse.json({ sessions: rows });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const pool = getPool();
    const result = await pool.query(
      `delete from chat_sessions
       where user_id = $1 and id = $2
       returning id`,
      [user.id, sessionId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    return NextResponse.json({ deletedId: result.rows[0].id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
