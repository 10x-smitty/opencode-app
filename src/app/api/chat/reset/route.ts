import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();

    await pool.query("delete from chat_sessions where user_id = $1", [user.id]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Could not start a new chat" }, { status: 500 });
  }
}
