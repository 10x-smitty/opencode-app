import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getChartmetricArtistContext } from "@/lib/chartmetric";
import { getPool } from "@/lib/db";
import { createOpencodeSession, promptOpencode } from "@/lib/opencode";

type ChatRequest = {
  content?: string;
  artistId?: string;
};

async function getOrCreateSession(userId: string, title: string) {
  const pool = getPool();
  const existing = await pool.query(
    `select id, opencode_session_id
     from chat_sessions
     where user_id = $1
     order by created_at asc
     limit 1`,
    [userId],
  );

  if (existing.rows[0]) {
    return existing.rows[0] as { id: string; opencode_session_id: string };
  }

  const opencodeSessionId = await createOpencodeSession(title);
  const created = await pool.query(
    `insert into chat_sessions (user_id, title, opencode_session_id)
     values ($1, $2, $3)
     returning id, opencode_session_id`,
    [userId, title, opencodeSessionId],
  );

  return created.rows[0] as { id: string; opencode_session_id: string };
}

async function refreshOpencodeSession(sessionId: string, title: string) {
  const pool = getPool();
  const opencodeSessionId = await createOpencodeSession(title);
  const updated = await pool.query(
    `update chat_sessions
     set opencode_session_id = $1
     where id = $2
     returning id, opencode_session_id`,
    [opencodeSessionId, sessionId],
  );

  return updated.rows[0] as { id: string; opencode_session_id: string };
}

function isRetryableOpencodeError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes('"name":"UnknownError"') ||
      error.message.includes('"name":"NotFoundError"') ||
      error.message.includes("Session not found"))
  );
}

function buildAskArtiePrompt(content: string, chartmetricContext: string) {
  return [
    "You are Ask Artie. Answer the user's question using the Chartmetric context below as the primary artist data source.",
    "If Chartmetric is not configured or a metric is unavailable, say that plainly and ask for the missing setup or data.",
    "Do not invent Spotify, social, tour, merch, or fan-community connector data that is not present in the context.",
    "",
    "<chartmetric_context>",
    chartmetricContext,
    "</chartmetric_context>",
    "",
    "<user_question>",
    content,
    "</user_question>",
  ].join("\n");
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const pool = getPool();
    const body = (await request.json()) as ChatRequest;
    const content = body.content?.trim();

    if (!content) {
      return NextResponse.json({ error: "Message content is required" }, { status: 400 });
    }

    const session = await getOrCreateSession(user.id, content.slice(0, 72));

    const userMessage = await pool.query(
      `insert into chat_messages (session_id, user_id, role, content)
       values ($1, $2, 'user', $3)
       returning id, role, content, created_at`,
      [session.id, user.id, content],
    );

    const chartmetricContext = await getChartmetricArtistContext(body.artistId);
    const prompt = buildAskArtiePrompt(content, chartmetricContext);

    let reply: string;
    try {
      reply = await promptOpencode(session.opencode_session_id, prompt);
    } catch (error) {
      if (!isRetryableOpencodeError(error)) throw error;

      console.warn("Refreshing opencode session after retryable prompt failure", {
        chatSessionId: session.id,
        opencodeSessionId: session.opencode_session_id,
      });

      const refreshed = await refreshOpencodeSession(session.id, content.slice(0, 72));
      reply = await promptOpencode(refreshed.opencode_session_id, prompt);
    }

    const assistantMessage = await pool.query(
      `insert into chat_messages (session_id, user_id, role, content)
       values ($1, $2, 'assistant', $3)
       returning id, role, content, created_at`,
      [session.id, user.id, reply],
    );

    return NextResponse.json({
      messages: [userMessage.rows[0], assistantMessage.rows[0]],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed" },
      { status: 500 },
    );
  }
}
