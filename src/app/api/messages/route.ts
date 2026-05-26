import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const { rows } = await pool.query(
      `select id, role, content, created_at
       from chat_messages
       where user_id = $1
       order by created_at asc`,
      [user.id],
    );

    return NextResponse.json({ messages: rows });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
