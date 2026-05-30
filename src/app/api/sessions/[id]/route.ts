import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getPool } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

type PatchBody = {
  pinned?: boolean;
  archived?: boolean;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const sessionId = id?.trim();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const body = (await request.json()) as PatchBody;
    const sets: string[] = [];

    if (typeof body.pinned === "boolean") {
      sets.push(`pinned_at = ${body.pinned ? "now()" : "null"}`);
    }
    if (typeof body.archived === "boolean") {
      sets.push(`archived_at = ${body.archived ? "now()" : "null"}`);
      if (body.archived) sets.push("pinned_at = null");
    }

    if (!sets.length) {
      return NextResponse.json(
        { error: "Provide pinned or archived in body" },
        { status: 400 },
      );
    }

    const pool = getPool();
    const result = await pool.query(
      `update chat_sessions
         set ${sets.join(", ")}
       where user_id = $1 and id = $2
       returning id, title, artist_id, artist_name, created_at, pinned_at, archived_at`,
      [user.id, sessionId],
    );

    if (!result.rows[0]) {
      return NextResponse.json({ error: "Chat session not found" }, { status: 404 });
    }

    return NextResponse.json({ session: result.rows[0] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update session" },
      { status: 500 },
    );
  }
}
