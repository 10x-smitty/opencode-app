import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  ASK_ARTIE_RESPONSE_JSON_SCHEMA,
  parseAskArtieResponse,
  renderAskArtieResponse,
  type AskArtieResponse,
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

function buildAskArtiePrompt(content: string, chartmetricContext: string) {
  return [
    "You are Ask Artie. Answer the user's question using the artist data context below as the primary source of truth.",
    "Return valid JSON only. Do not return Markdown prose outside the JSON object.",
    "The application will validate this JSON and render it into the canonical Markdown response.",
    "Required JSON shape:",
    ASK_ARTIE_RESPONSE_JSON_SCHEMA,
    "",
    "STEP 1 — CLASSIFY the question (set `responseKind`):",
    "",
    "Use `responseKind: \"map\"` when the answer's primary axis is GEOGRAPHIC — where something is happening, concentrated, or should happen. Examples:",
    "- Tour planning / routing: 'Where should I tour?', 'What's the next city after Santiago?', 'Plan a South American leg'",
    "- Market priority: 'Which markets should I focus on?', 'Top market in Europe?', 'Where should I do press?'",
    "- Audience geography: 'Where do my listeners live?', 'What cities have the most fans?', 'Where are my Instagram followers?'",
    "- Growth / momentum geo: 'Where are my fans growing fastest?', 'Cities trending up for me'",
    "- Gap analysis: 'Cities I haven't played but should', 'Under-served markets'",
    "- Show / venue placement: 'Where should the release event be?', 'Best city for the album launch?'",
    "",
    "Use `responseKind: \"table\"` when the answer is a RANKED OR COMPARED LIST OF NAMED ENTITIES (people, tracks, playlists, artists, posts, releases). Examples:",
    "- People rankings: 'Who are my superfans?', 'Top influential fans?', 'Biggest playlist curators?'",
    "- Track rankings: 'What are my top songs?', 'Which tracks grew the most?', 'Most-saved tracks?', 'Top-earning songs?'",
    "- Playlist rankings: 'What playlists is my music on?', 'Which playlists send the most streams?'",
    "- Artist comparison: 'Similar artists I should watch?', 'Top collab candidates?', 'Closest peer in my genre?'",
    "- Content / platform compare: 'Which content types perform best?', 'Which DSPs send the most listeners?'",
    "- Show / release history: 'Which shows sold through best?', 'Compare my last three releases'",
    "",
    "Use `responseKind: \"neither\"` when the question is general guidance, strategy, or doesn't require a map or comparison table. Examples: 'How should I price merch?', 'When should I release the single?', 'What should I focus on?'",
    "",
    "DISAMBIGUATION (the most common mistakes — read carefully):",
    "- 'Top fans in NYC' → \"table\". The location is a FILTER; the answer is a ranked list of named fans. A single-pin map of NYC is useless here.",
    "- 'How are my songs doing in Europe?' → \"table\". The answer is a ranked list of songs with stream counts; Europe is a filter context.",
    "- 'Where are my top songs streamed most?' → \"map\". Geographic distribution IS the answer.",
    "- 'Compare my touring markets' → \"map\" (geographic comparison is more informative when coords are available).",
    "- If you can't pick confidently, use \"neither\".",
    "",
    "STEP 2 — EVIDENCE FORMAT (driven by `responseKind`):",
    "- If `responseKind === \"map\"`: include EXACTLY ONE `map` widget with `placement: \"why\"`. Each point needs name, latitude, longitude, and a value or label. Point count depends on `mapKind` (see STEP 2A). Do NOT include `whyTable`. If you genuinely cannot supply coordinates, switch to `responseKind: \"table\"` or `\"neither\"` instead.",
    "- If `responseKind === \"table\"`: do NOT include any widgets. Populate `whyTable` with `columns` and `rows`. The app renders it as a Markdown table inside the Why section.",
    "- If `responseKind === \"neither\"`: do NOT include any widgets and do NOT include `whyTable`. The bullets alone carry the answer.",
    "- NEVER combine widgets with `whyTable`. NEVER include more than one widget. The server strips violations and re-runs the response, slowing the user down.",
    "",
    "STEP 2A — MAP KIND (only when `responseKind === \"map\"`, set `widgets[0].mapKind`):",
    "",
    "Use `mapKind: \"markets\"` when the answer is a CURATED, PRIORITY-DRIVEN list of markets — which markets to focus on, where to go next, where to invest. The user is making a decision and needs a few specific places to act on. Examples:",
    "- 'Top markets for my next single?', 'Where should I tour next?', 'Where should I do press?'",
    "- 'Which 5 cities should I prioritize for promo?', 'Best markets for a billboard campaign?'",
    "- 'Where am I growing fastest right now?', 'Cities trending up for me?', 'Cities I haven't played but should'",
    "- 'Compare my Spotify performance across the top 10 cities' (comparison of a curated set is markers, not clusters)",
    "→ Markers only, no connecting lines. Limit 3-8 points. Each point must carry a value AND a reason in its label (why THIS market). The map auto-fits to the regional bounds (country/continent scale).",
    "",
    "Use `mapKind: \"venues\"` when the answer is a list of specific places (venues, clubs, halls, hotels, neighborhoods, stores) INSIDE a single city or metro. Examples:",
    "- 'What venues should I consider in Chicago?', 'Recommended clubs in Berlin?', 'Where should the album launch event be in LA?'",
    "- 'Best neighborhoods for street-team flyering in Austin?', 'Record stores to hit in Tokyo?'",
    "→ Markers only, no connecting lines. The map zooms to the city/metro level (street-grid visible). Every point must be inside the same city/metro. Limit 3-8 points.",
    "",
    "Use `mapKind: \"routing\"` when the answer is an ORDERED itinerary across multiple cities — a tour leg, a press circuit, a route plan. Examples:",
    "- 'Plan a South American tour leg', 'Routing for a US summer tour?', 'Best order to play these cities?', 'What's the next city after Santiago?'",
    "- 'Lay out a 5-city press run in Europe'",
    "→ Markers PLUS a connecting line drawn through points in array order. The array ORDER must be the travel order — first item is stop #1, last item is the final stop. Order points to minimize backtracking. Limit 3-8 points.",
    "",
    "Use `mapKind: \"clusters\"` for MARKET-SIZE / AUDIENCE-FOOTPRINT / COVERAGE / DENSITY questions where the answer is the SHAPE of a distribution itself. The user is orienting, not picking. Examples:",
    "- 'Map my audience footprint', 'Where do I have any listeners at all?', 'Show my Spotify listener density by city'",
    "- 'Map every city where my music has been streamed', 'How widespread is my Latin America listenership?'",
    "- 'Plot my full TikTok creator footprint', 'All playlists that added me, by curator location'",
    "- 'Map every venue I've ever played', 'My complete tour history on a map'",
    "→ Emit AS MANY points as you can — aim for 15-60, but emit clusters with 10+ if that's all you can supply. Do NOT downgrade to `markets` because of point count; if the question is cluster-shaped, the answer is clusters with whatever points you have.",
    "→ CRITICAL — point `value` for clusters MUST be an INTEGER fan count for that market, summed across all available platforms (Spotify monthly listeners + Instagram followers + TikTok followers + YouTube subscribers — include whichever platforms have data for that city; omit ones you don't have). The cluster circle SIZE is driven by the SUM of these values across cities in the cluster — so this number is what visualizes market magnitude. Do NOT put strings, formatted numbers (e.g. '1.2K'), or non-fan metrics in `value` for clusters. The number must be the raw integer.",
    "→ Bias data: prefer Spotify monthly listeners as the dominant signal if you must pick one (it's most often available). When in doubt, use a conservative integer rather than skipping the point.",
    "",
    "EXPLICIT CLUSTER TRIGGERS — if the user's question contains any of these phrasings, you MUST use `mapKind: \"clusters\"` (these phrasings signal magnitude/coverage intent, not curation):",
    "  • 'every X' / 'all X' / 'any X' — e.g. 'every city', 'all the venues', 'any listeners'",
    "  • 'footprint' / 'coverage' / 'density' / 'distribution' / 'reach' / 'widespread'",
    "  • 'map my full ___' / 'plot my full ___' / 'complete ___'",
    "  • 'how big is my audience across ___' (multi-place, plural)",
    "",
    "MARKETS vs CLUSTERS — the deciding heuristic: use `clusters` when the answer would be UNSATISFYING if cut to 8 points (because the value IS seeing the full distribution). Use `markets` when the answer would be UNHELPFUL if expanded to 30 points (because the value IS the curation).",
    "",
    "ALSO: comparison questions about a curated set ('compare my top 10 markets') are `markets`, not `clusters`. Comparison ≠ distribution. And single-city size questions ('how big is my Chicago audience?') are usually `responseKind: \"neither\"` (a number, not a map).",
    "",
    "Grounding rules:",
    "- Only claim a metric, ranking, location, demographic, revenue figure, or connector result if it appears in the artist data context or the user's message.",
    "- Do not claim OAuth, live Spotify account, Instagram account, TikTok account, merch, email, ticketing, revenue, or other connector data unless present.",
    "- Do not promise that a pasted Chartmetric link or OAuth request will automatically connect live data from chat. Say the server data source must be configured, or ask the user to paste/export metrics.",
    "- If data is unavailable or the selected artist has no connected data, say that plainly in `theAnswer` before recommending next steps.",
    "- `theAnswer` is one prose paragraph. Name the artist and the primary market/city when the context allows it. No bullets, no headings.",
    "- `why`, `whatIRecommend`, and `whatToExpect` are bullet arrays. Each bullet is an object with a `text` field only. Do NOT include an `emoji` field on bullets — emojis belong on the section headers, not the bullets.",
    "- Label judgment calls as recommendations or assumptions inside the relevant bullet text.",
    "- If confidence is low or data is missing, surface that in `whatToExpect` or in the optional `methodology` footer.",
    "- `suggestions` is an array of 2-4 short follow-up questions the user would plausibly ask next, given this answer. Each suggestion must be under 8 words, end with `?`, and reference something concrete from this answer (a city, metric, market, etc.). Examples: 'How big is the Santiago audience?', 'What venue size in Buenos Aires?'. Do not repeat the user's original question.",
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

function enforceResponsePolicy(response: AskArtieResponse): AskArtieResponse {
  if (response.responseKind === "map") {
    const firstMap = (response.widgets ?? []).find((widget) => widget.type === "map");
    const allowedMapKinds = new Set(["markets", "venues", "routing", "clusters"]);
    const rawMapKind = firstMap?.mapKind;
    const mapKind =
      typeof rawMapKind === "string" && allowedMapKinds.has(rawMapKind) ? rawMapKind : "markets";
    const pointCount = Array.isArray(firstMap?.points) ? (firstMap?.points as unknown[]).length : 0;
    console.log(
      `[ask-artie] responseKind=map mapKind=${mapKind} (model said ${JSON.stringify(rawMapKind)}) points=${pointCount}`,
    );
    return {
      ...response,
      widgets: firstMap ? [{ ...firstMap, placement: "why", mapKind }] : [],
      whyTable: undefined,
    };
  }

  if (response.responseKind === "table") {
    return {
      ...response,
      widgets: [],
    };
  }

  // responseKind === "neither"
  return {
    ...response,
    widgets: [],
    whyTable: undefined,
  };
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
  const errorMessage =
    validationError instanceof Error ? validationError.message : String(validationError);

  return renderAskArtieResponse({
    responseKind: "neither",
    theAnswer:
      "Ask Artie couldn't validate the model response, so no answer was rendered. Re-ask the question with the metric, city, platform, or decision you want prioritized and a fresh answer will be generated.",
    why: [
      {
        text: `The model response failed the Ask Artie schema check: ${errorMessage}`,
      },
      {
        text: "No unsupported metrics or malformed widgets were rendered from the invalid output.",
      },
    ],
    whatIRecommend: [
      {
        text: "Re-run the question, ideally with the key metric, market, or platform you want prioritized.",
      },
      {
        text: "Use the available Chartmetric data or paste the metrics you want analyzed as the source of truth.",
      },
    ],
    whatToExpect: [
      {
        text: "A re-asked question typically produces a valid structured answer; persistent failures usually indicate missing connector data.",
      },
    ],
    methodology: "Fallback rendered by the Ask Artie response validator.",
  });
}

async function getValidatedReply(opencodeSessionId: string, prompt: string) {
  const rawReply = await promptOpencode(opencodeSessionId, prompt);

  const renderEnforced = (raw: string) =>
    renderAskArtieResponse(enforceResponsePolicy(parseAskArtieResponse(raw)));

  try {
    return renderEnforced(rawReply);
  } catch (error) {
    const repairPrompt = buildRepairPrompt(rawReply, error);
    const repairedReply = await promptOpencode(opencodeSessionId, repairPrompt);
    try {
      return renderEnforced(repairedReply);
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
