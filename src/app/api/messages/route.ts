import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ messages: [] });
    }

    const { rows } = await pool.query(
      `select id, session_id, role, content, created_at
       from chat_messages
       where user_id = $1 and session_id = $2
       order by created_at asc`,
      [user.id, sessionId],
    );

    return NextResponse.json({ messages: rows });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
