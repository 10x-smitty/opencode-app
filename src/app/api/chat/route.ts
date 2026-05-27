import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getChartmetricArtistContext } from "@/lib/chartmetric";
import { getPool } from "@/lib/db";
import { createOpencodeSession, promptOpencode } from "@/lib/opencode";

type ChatRequest = {
  content?: string;
  artistId?: string;
  artistName?: string;
  sessionId?: string;
};

type ChatSessionRow = {
  id: string;
  title: string;
  opencode_session_id: string;
  artist_id: string | null;
  artist_name: string | null;
};

async function getOrCreateSession(
  userId: string,
  title: string,
  artistId: string | null,
  artistName: string | null,
  requestedSessionId?: string,
) {
  const pool = getPool();

  if (requestedSessionId) {
    const existing = await pool.query(
      `select id, title, opencode_session_id, artist_id, artist_name
       from chat_sessions
       where user_id = $1 and id = $2
       limit 1`,
      [userId, requestedSessionId],
    );

    if (existing.rows[0]) {
      const session = existing.rows[0] as ChatSessionRow;
      if (session.artist_id && artistId && session.artist_id !== artistId) {
        return getOrCreateSession(userId, title, artistId, artistName);
      }

      if (!session.artist_id && artistId) {
        const updated = await pool.query(
          `update chat_sessions
           set artist_id = $1, artist_name = $2
           where user_id = $3 and id = $4
           returning id, title, opencode_session_id, artist_id, artist_name`,
          [artistId, artistName, userId, session.id],
        );
        return updated.rows[0] as ChatSessionRow;
      }

      return session;
    }
  }

  const opencodeSessionId = await createOpencodeSession(title);
  const created = await pool.query(
    `insert into chat_sessions (user_id, title, artist_id, artist_name, opencode_session_id)
     values ($1, $2, $3, $4, $5)
     returning id, title, opencode_session_id, artist_id, artist_name`,
    [userId, title, artistId, artistName, opencodeSessionId],
  );

  return created.rows[0] as ChatSessionRow;
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

function isLocationPrompt(content: string) {
  return /\b(location|locations|city|cities|market|markets|map|geo|geography|region|regions|tour|touring|route|routing|fanbase|audience location|where)\b/i.test(
    content,
  );
}

function buildAskArtiePrompt(content: string, chartmetricContext: string) {
  const wantsLocationAnswer = isLocationPrompt(content);

  return [
    "You are Ask Artie. Answer the user's question using the artist data context below as the primary source of truth.",
    "Use this Markdown response contract for data-backed strategy answers:",
    "## What the data says",
    "## What I'd do next",
    "## Why this matters",
    "## Confidence / missing data",
    "",
    "Grounding rules:",
    "- Only claim a metric, ranking, location, demographic, revenue figure, or connector result if it appears in the artist data context or the user's message.",
    "- Do not claim OAuth, live Spotify account, Instagram account, TikTok account, merch, email, ticketing, revenue, or other connector data unless present.",
    "- Do not promise that a pasted Chartmetric link or OAuth request will automatically connect live data from chat. Say the server data source must be configured, or ask the user to paste/export metrics.",
    "- If data is unavailable or the selected artist has no connected data, say that plainly before recommending next steps.",
    "- In `What the data says`, identify the selected artist and data source when the context provides them.",
    "- Label judgment calls as recommendations or assumptions.",
    "",
    "Optional data widgets:",
    "- When the answer would be clearer as structured data, include one fenced `artie-widget` JSON block after the relevant paragraph.",
    "- Use a `table` widget instead of a plain markdown table for any ranked list, comparison table, release plan, city list, market list, content calendar, or action matrix.",
    "- Use widgets only for data that appears in the artist data context or user message.",
    "- Supported widget types:",
    '  - Interactive table: ```artie-widget {"type":"table","title":"...","columns":[{"key":"city","label":"City"}],"rows":[{"city":"Nashville","signal":"High active audience"}]} ```',
    '  - Interactive map: ```artie-widget {"type":"map","title":"Priority markets","points":[{"name":"Nashville","latitude":36.1627,"longitude":-86.7816,"value":"8.32% likes","label":"Top active IG city"}]} ```',
    '  - Bar chart: ```artie-widget {"type":"barChart","title":"Audience signals","xLabel":"Score","data":[{"label":"Instagram","value":239900},{"label":"TikTok","value":40100}]} ```',
    "- For maps, only include points when latitude and longitude are available in context or are common city coordinates you are confident about. Otherwise use a table.",
    "- For map widgets, include useful `value` and `label` fields because the UI shows clickable marker popups and a location list.",
    "- For table widgets, keep rows concise and use stable column keys because the UI provides filtering and sorting.",
    "- Do not wrap widget JSON in another markdown code block or add comments inside JSON.",
    wantsLocationAnswer
      ? [
          "",
          "Location-response requirement:",
          "- This user is asking about locations, markets, routing, geography, touring, or audience geography.",
          "- Include a `map` artie-widget when you mention two or more cities/markets and can provide coordinates.",
          "- If you cannot provide coordinates for a location, include a table widget instead and explain that coordinates were unavailable.",
          "- Keep the map points limited to the highest-priority 3-8 markets so the widget stays readable.",
          "- Each map point must include name, latitude, longitude, and value or label explaining the observed signal.",
        ].join("\n")
      : "",
    "",
    "<artist_data_context>",
    chartmetricContext,
    "</artist_data_context>",
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

    const artistId = body.artistId?.trim() || null;
    const artistName = body.artistName?.trim() || null;
    const session = await getOrCreateSession(
      user.id,
      content.slice(0, 72),
      artistId,
      artistName,
      body.sessionId,
    );

    const userMessage = await pool.query(
      `insert into chat_messages (session_id, user_id, role, content)
       values ($1, $2, 'user', $3)
       returning id, session_id, role, content, created_at`,
      [session.id, user.id, content],
    );

    if (session.title === "New chat") {
      await pool.query(
        `update chat_sessions
         set title = $1
         where id = $2 and user_id = $3`,
        [content.slice(0, 72), session.id, user.id],
      );
      session.title = content.slice(0, 72);
    }

    const chartmetricContext = await getChartmetricArtistContext(body.artistId, body.artistName);
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
       returning id, session_id, role, content, created_at`,
      [session.id, user.id, reply],
    );

    return NextResponse.json({
      session: {
        id: session.id,
        title: session.title,
        artist_id: session.artist_id,
        artist_name: session.artist_name,
      },
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
