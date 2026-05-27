import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  ASK_ARTIE_RESPONSE_JSON_SCHEMA,
  parseAskArtieResponse,
  renderAskArtieResponse,
} from "@/lib/ask-artie-response";
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
    "Return valid JSON only. Do not return Markdown prose outside the JSON object.",
    "The application will validate this JSON and render it into the canonical Markdown response.",
    "Required JSON shape:",
    ASK_ARTIE_RESPONSE_JSON_SCHEMA,
    "",
    "Grounding rules:",
    "- Only claim a metric, ranking, location, demographic, revenue figure, or connector result if it appears in the artist data context or the user's message.",
    "- Do not claim OAuth, live Spotify account, Instagram account, TikTok account, merch, email, ticketing, revenue, or other connector data unless present.",
    "- Do not promise that a pasted Chartmetric link or OAuth request will automatically connect live data from chat. Say the server data source must be configured, or ask the user to paste/export metrics.",
    "- If data is unavailable or the selected artist has no connected data, say that plainly before recommending next steps.",
    "- In `whatTheDataSays.summary`, identify the selected artist and data source when the context provides them.",
    "- `whatTheDataSays.table` is required for every answer. Use a concise evidence table even when data is missing.",
    "- The table must use plain values only; do not put Markdown table syntax inside the JSON.",
    "- Label judgment calls as recommendations or assumptions.",
    "",
    "Optional data widgets:",
    "- Put optional widgets in the top-level `widgets` array, not as Markdown fences.",
    "- Do not use a widget for the required `whatTheDataSays.table`; that table is rendered as a plain Markdown table by the app.",
    "- Supported widget types are `table`, `map`, and `barChart` using the app-supported artie-widget payload shape.",
    "- For maps, only include points when latitude and longitude are available in context or are common city coordinates you are confident about. Otherwise use a table.",
    "- For map widgets, include useful `value` and `label` fields because the UI shows clickable marker popups and a location list.",
    "- For table widgets, keep rows concise and use stable column keys because the UI provides filtering and sorting.",
    wantsLocationAnswer
      ? [
          "",
          "Location-response requirement:",
          "- This user is asking about locations, markets, routing, geography, touring, or audience geography.",
          "- Include a `map` widget in `widgets` when you mention two or more cities/markets and can provide coordinates.",
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

function buildRepairPrompt(rawReply: string, validationError: unknown) {
  return [
    "Your previous Ask Artie response did not match the required JSON contract.",
    "Return corrected valid JSON only. Do not include Markdown outside the JSON object.",
    "",
    "Validation error:",
    validationError instanceof Error ? validationError.message : String(validationError),
    "",
    "Required JSON shape:",
    ASK_ARTIE_RESPONSE_JSON_SCHEMA,
    "",
    "Previous response:",
    rawReply,
  ].join("\n");
}

function renderFallbackReply(validationError: unknown) {
  return renderAskArtieResponse({
    whatTheDataSays: {
      summary:
        "Ask Artie could not validate the model response, so this answer is limited to the available context and should be treated as a formatting fallback.",
      table: {
        columns: ["Signal", "Value", "Source", "Implication"],
        rows: [
          [
            "Validated response",
            "Unavailable",
            "Ask Artie response validator",
            "The model response needs to be regenerated before using it for a decision.",
          ],
          [
            "Validation issue",
            validationError instanceof Error ? validationError.message : String(validationError),
            "Server validation",
            "No unsupported claims were rendered from the invalid model output.",
          ],
        ],
      },
    },
    whatIdDoNext: [
      "Regenerate the answer or ask the question again with the key metric, city, platform, or decision you want prioritized.",
      "Use the available Chartmetric or pasted data as the source of truth for the next response.",
    ],
    whyThisMatters:
      "A validated answer is required so the chat keeps the same sections, includes a data table, and does not render unsupported metrics or malformed widgets.",
    readinessDataGaps: {
      confidence: "Low",
      notes: ["The model response failed the enforced Ask Artie schema."],
    },
  });
}

async function getValidatedReply(opencodeSessionId: string, prompt: string) {
  const rawReply = await promptOpencode(opencodeSessionId, prompt);

  try {
    return renderAskArtieResponse(parseAskArtieResponse(rawReply));
  } catch (error) {
    const repairPrompt = buildRepairPrompt(rawReply, error);
    const repairedReply = await promptOpencode(opencodeSessionId, repairPrompt);
    try {
      return renderAskArtieResponse(parseAskArtieResponse(repairedReply));
    } catch (repairError) {
      console.warn("Ask Artie response validation failed after repair", {
        initialError: error instanceof Error ? error.message : String(error),
        repairError: repairError instanceof Error ? repairError.message : String(repairError),
      });
      return renderFallbackReply(repairError);
    }
  }
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
      reply = await getValidatedReply(session.opencode_session_id, prompt);
    } catch (error) {
      if (!isRetryableOpencodeError(error)) throw error;

      console.warn("Refreshing opencode session after retryable prompt failure", {
        chatSessionId: session.id,
        opencodeSessionId: session.opencode_session_id,
      });

      const refreshed = await refreshOpencodeSession(session.id, content.slice(0, 72));
      reply = await getValidatedReply(refreshed.opencode_session_id, prompt);
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
