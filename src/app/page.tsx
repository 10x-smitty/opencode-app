"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ResponseWidget } from "@/components/ResponseWidgets";
import { markdownComponents } from "@/components/MarkdownComponents";
import { extractSuggestions, splitMessageWidgets } from "@/lib/widgets";
import type { ArtistOption, ArtistSearchResult, ChatMessage, ChatSession } from "@/types/chat";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase public environment variables");
}

const supabaseConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
};

const ADD_ARTIST_VALUE = "__add_artist__";
const INITIAL_ARTISTS: ArtistOption[] = [
  {
    id: "1029268",
    name: "Caleb Lee Hutchinson",
    dataLabel: "Live Chartmetric",
  },
];

const STARTER_QUESTIONS = [
  "Where should I tour?",
  "What content works best?",
  "Who are my influential fans?",
  "Playlist activity",
];

function getInitials(value?: string | null) {
  const parts = (value ?? "")
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.slice(0, 2) || "AA").toUpperCase();
}

function MessageContent({ message }: { message: ChatMessage }) {
  if (message.role !== "assistant") {
    return <div className="message-content">{message.content}</div>;
  }

  const segments = splitMessageWidgets(message.content);

  return (
    <div className="message-content markdown-content">
      {segments.map((segment, index) =>
        segment.type === "widget" ? (
          <ResponseWidget key={`widget-${index}`} widget={segment.widget} />
        ) : (
          <ReactMarkdown
            key={`markdown-${index}`}
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {segment.content}
          </ReactMarkdown>
        ),
      )}
    </div>
  );
}

export default function Home() {
  const supabase = useMemo(
    () => createClient(supabaseConfig.url, supabaseConfig.anonKey),
    [],
  );

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("password123");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artists, setArtists] = useState<ArtistOption[]>(INITIAL_ARTISTS);
  const [selectedArtistId, setSelectedArtistId] = useState(INITIAL_ARTISTS[0].id);
  const [isArtistOnboardingOpen, setIsArtistOnboardingOpen] = useState(false);
  const [artistSearchQuery, setArtistSearchQuery] = useState("");
  const [artistSearchResults, setArtistSearchResults] = useState<ArtistSearchResult[]>([]);
  const [artistSearchStatus, setArtistSearchStatus] = useState("");
  const [isArtistSearching, setIsArtistSearching] = useState(false);
  const [isAddingArtist, setIsAddingArtist] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState("");
  const [deletingArtistId, setDeletingArtistId] = useState("");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const selectedArtist = artists.find((artist) => artist.id === selectedArtistId);
  const activeChatSession = chatSessions.find((item) => item.id === activeSessionId);
  const followUpSuggestions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== "assistant") continue;
      const found = extractSuggestions(message.content);
      if (found.length) return found.slice(0, 4);
      return [];
    }
    return [];
  }, [messages]);

  const authHeaders = useMemo(
    () =>
      session?.access_token
        ? {
            authorization: `Bearer ${session.access_token}`,
          }
        : null,
    [session?.access_token],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setChatSessions([]);
        setActiveSessionId("");
        setMessages([]);
      }
    });

    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session?.access_token) return;

    fetch("/api/sessions", {
      headers: {
        authorization: `Bearer ${session.access_token}`,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load chat sessions");
        return response.json();
      })
      .then((data: { sessions: ChatSession[] }) => {
        setChatSessions(data.sessions);
        setActiveSessionId((current) => current || data.sessions[0]?.id || "");
      })
      .catch((error: Error) => setStatus(error.message));
  }, [session]);

  useEffect(() => {
    if (!authHeaders) return;

    fetch("/api/artists", {
      headers: authHeaders,
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load artists");
        return response.json();
      })
      .then((data: { artists: ArtistOption[] }) => {
        const nextArtists = data.artists.length ? data.artists : INITIAL_ARTISTS;
        setArtists(nextArtists);
        setSelectedArtistId((current) =>
          nextArtists.some((artist) => artist.id === current) ? current : nextArtists[0].id,
        );
      })
      .catch((error: Error) => setStatus(error.message));
  }, [authHeaders]);

  useEffect(() => {
    if (!session?.access_token || !activeSessionId) {
      setMessages([]);
      return;
    }

    fetch(`/api/messages?sessionId=${encodeURIComponent(activeSessionId)}`, {
      headers: {
        authorization: `Bearer ${session.access_token}`,
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error("Could not load chat history");
        return response.json();
      })
      .then((data: { messages: ChatMessage[] }) => setMessages(data.messages))
      .catch((error: Error) => setStatus(error.message));
  }, [session, activeSessionId]);

  useEffect(() => {
    if (!activeChatSession?.artist_id) return;
    if (artists.some((artist) => artist.id === activeChatSession.artist_id)) {
      setSelectedArtistId(activeChatSession.artist_id);
    }
  }, [activeChatSession?.artist_id, artists]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    const result =
      authMode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setStatus(result.error.message);
      return;
    }

    setStatus("");
  }

  async function submitContent(rawContent: string) {
    const content = rawContent.trim();
    if (!content || !session?.access_token || isSending) return;

    setDraft("");
    setIsSending(true);
    setStatus("");

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      session_id: activeSessionId || "local",
      role: "user",
      content,
      created_at: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimistic]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          content,
          artistId: selectedArtistId,
          artistName: selectedArtist?.name,
          sessionId: activeSessionId || undefined,
        }),
      });

      const data = await response.json() as {
        session?: Pick<ChatSession, "id" | "title" | "artist_id" | "artist_name">;
        messages: ChatMessage[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Chat request failed");

      if (data.session) {
        setActiveSessionId(data.session.id);
        setChatSessions((current) => {
          const createdAt = new Date().toISOString();
          const nextSession: ChatSession = {
            id: data.session!.id,
            title: data.session!.title,
            artist_id: data.session!.artist_id,
            artist_name: data.session!.artist_name,
            created_at: current.find((item) => item.id === data.session!.id)?.created_at ?? createdAt,
          };
          const withoutSession = current.filter((item) => item.id !== data.session!.id);
          return [nextSession, ...withoutSession];
        });
      }

      setMessages((current) => [
        ...current.filter((message) => message.id !== optimistic.id),
        ...data.messages,
      ]);
    } catch (error) {
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setStatus(error instanceof Error ? error.message : "Chat request failed");
    } finally {
      setIsSending(false);
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    return submitContent(draft);
  }

  async function startNewChat(artistOverride = selectedArtist) {
    if (!session?.access_token) return;

    setStatus("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat/reset", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          artistId: artistOverride?.id,
          artistName: artistOverride?.name,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start a new chat");

      setChatSessions((current) => [data.session, ...current]);
      setActiveSessionId(data.session.id);
      setMessages([]);
      setDraft("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start a new chat");
    } finally {
      setIsSending(false);
    }
  }

  async function selectArtist(value: string) {
    if (value !== ADD_ARTIST_VALUE) {
      const nextArtist = artists.find((artist) => artist.id === value);
      if (!nextArtist || nextArtist.id === selectedArtistId) return;

      setSelectedArtistId(value);
      if (activeSessionId) {
        await startNewChat(nextArtist);
      } else {
        setMessages([]);
        setDraft("");
      }
      return;
    }

    setIsArtistOnboardingOpen(true);
    setArtistSearchStatus("");
    setArtistSearchResults([]);
  }

  async function deleteChatSession(chatSession: ChatSession) {
    if (!authHeaders || deletingSessionId) return;

    setDeletingSessionId(chatSession.id);
    setStatus("");

    try {
      const response = await fetch(
        `/api/sessions?sessionId=${encodeURIComponent(chatSession.id)}`,
        {
          method: "DELETE",
          headers: authHeaders,
        },
      );
      const data = (await response.json()) as { deletedId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not delete chat");

      setChatSessions((current) => {
        const next = current.filter((item) => item.id !== chatSession.id);
        if (activeSessionId === chatSession.id) {
          setActiveSessionId(next[0]?.id ?? "");
          if (!next[0]) setMessages([]);
        }
        return next;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete chat");
    } finally {
      setDeletingSessionId("");
    }
  }

  async function deleteArtist(artist: ArtistOption) {
    if (!authHeaders || artist.isDefault || deletingArtistId) return;

    setDeletingArtistId(artist.id);
    setStatus("");

    try {
      const response = await fetch(`/api/artists?artistId=${encodeURIComponent(artist.id)}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const data = (await response.json()) as { deletedId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not delete artist");

      setArtists((current) => {
        const next = current.filter((item) => item.id !== artist.id);
        if (selectedArtistId === artist.id) {
          setSelectedArtistId(next[0]?.id ?? INITIAL_ARTISTS[0].id);
        }
        return next.length ? next : INITIAL_ARTISTS;
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete artist");
    } finally {
      setDeletingArtistId("");
    }
  }

  async function searchArtists(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authHeaders) return;

    const query = artistSearchQuery.trim();
    if (query.length < 2) {
      setArtistSearchStatus("Type at least two characters to search Chartmetric.");
      setArtistSearchResults([]);
      return;
    }

    setIsArtistSearching(true);
    setArtistSearchStatus("");

    try {
      const response = await fetch(`/api/artists/search?q=${encodeURIComponent(query)}`, {
        headers: authHeaders,
      });
      const data = (await response.json()) as {
        results?: ArtistSearchResult[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Artist search failed");

      setArtistSearchResults(data.results ?? []);
      setArtistSearchStatus(data.results?.length ? "" : "No Chartmetric artists matched that search.");
    } catch (error) {
      setArtistSearchStatus(error instanceof Error ? error.message : "Artist search failed");
    } finally {
      setIsArtistSearching(false);
    }
  }

  async function addArtist(result: ArtistSearchResult) {
    if (!authHeaders) return;

    setIsAddingArtist(true);
    setArtistSearchStatus("");

    try {
      const response = await fetch("/api/artists", {
        method: "POST",
        headers: {
          ...authHeaders,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token: result.token }),
      });
      const data = (await response.json()) as {
        artist?: ArtistOption;
        error?: string;
      };
      if (!response.ok || !data.artist) throw new Error(data.error ?? "Could not add artist");

      setArtists((current) => {
        const withoutArtist = current.filter((artist) => artist.id !== data.artist!.id);
        return [...withoutArtist, data.artist!];
      });
      setSelectedArtistId(data.artist.id);
      setIsArtistOnboardingOpen(false);
      setArtistSearchQuery("");
      setArtistSearchResults([]);
    } catch (error) {
      setArtistSearchStatus(error instanceof Error ? error.message : "Could not add artist");
    } finally {
      setIsAddingArtist(false);
    }
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <div className="brand-row">
              <span className="brand-mark">AA</span>
              <span>Ask Artie</span>
            </div>
            <h1>Plan your next artist move with Ask Artie.</h1>
            <p className="subtle">
              Sign in to use the chat-first workspace backed by Supabase Auth,
              Postgres history, and an OpenCode-powered strategy agent.
            </p>
          </div>

          <form onSubmit={handleAuth} className="auth-form">
            <div>
              <p className="eyebrow">Account</p>
              <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
            </div>
            <label>
              Email
              <input
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="auth-actions">
              <button type="submit">
                {authMode === "signin" ? "Sign in" : "Create account"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
              >
                {authMode === "signin" ? "Use sign up" : "Use sign in"}
              </button>
            </div>
            {status ? <p className="status">{status}</p> : null}
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-row">
            <span className="brand-mark">AA</span>
            <span>Ask Artie</span>
          </div>
        </div>

        <div className="sidebar-main">
          <button
            className="new-chat-button"
            type="button"
            onClick={() => startNewChat()}
            disabled={isSending}
          >
            New chat
          </button>

          <section className="sidebar-section">
            <p className="sidebar-label">Chats</p>
            {chatSessions.length === 0 ? (
              <div className="thread-empty">No chats yet</div>
            ) : (
              chatSessions.map((chatSession) => (
                <div
                  key={chatSession.id}
                  className={`thread-item ${chatSession.id === activeSessionId ? "active" : ""}`}
                >
                  <button
                    className="thread-select"
                    type="button"
                    onClick={() => setActiveSessionId(chatSession.id)}
                  >
                    <span className="thread-title">{chatSession.title}</span>
                    {chatSession.artist_name ? (
                      <span className="thread-artist-tag">{chatSession.artist_name}</span>
                    ) : null}
                    <span className="thread-meta">
                      {chatSession.id === activeSessionId
                        ? messages.length
                          ? `${messages.length} messages`
                          : "No messages yet"
                        : new Date(chatSession.created_at).toLocaleDateString()}
                    </span>
                  </button>
                  <button
                    className="thread-delete"
                    type="button"
                    aria-label={`Delete ${chatSession.title}`}
                    disabled={deletingSessionId === chatSession.id}
                    onClick={() => deleteChatSession(chatSession)}
                  >
                    x
                  </button>
                </div>
              ))
            )}
          </section>
        </div>

        <div className="sidebar-footer">
          <details className="user-menu">
            <summary>
              <span className="avatar-badge">{getInitials(session.user.email)}</span>
              <span>{session.user.email}</span>
              <span className="menu-caret" aria-hidden="true" />
            </summary>
            <div className="user-menu-popover">
              <button type="button" onClick={() => supabase.auth.signOut()}>
                Log out
              </button>
            </div>
          </details>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <h1>Chat</h1>
            {activeChatSession ? <p className="chat-subtitle">{activeChatSession.title}</p> : null}
          </div>
          <details className="artist-menu">
            <summary aria-label="Artist">
              <span className="avatar-badge">{getInitials(selectedArtist?.name)}</span>
              <span>{selectedArtist?.name ?? "Select artist"}</span>
              <span className="menu-caret" />
            </summary>
            <div className="artist-menu-popover">
              {artists.map((artist) => (
                <div
                  key={artist.id}
                  className={`artist-menu-row ${artist.id === selectedArtistId ? "active" : ""}`}
                >
                  <button
                    className="artist-menu-select"
                    type="button"
                    onClick={() => selectArtist(artist.id)}
                  >
                    <span className="avatar-badge">{getInitials(artist.name)}</span>
                    <span className="artist-menu-copy">
                      <span>{artist.name}</span>
                      <span>{artist.isDefault ? "Default artist" : artist.dataLabel}</span>
                    </span>
                  </button>
                  {artist.isDefault ? null : (
                    <button
                      className="artist-menu-delete"
                      type="button"
                      aria-label={`Delete ${artist.name}`}
                      disabled={deletingArtistId === artist.id}
                      onClick={() => deleteArtist(artist)}
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
              <button
                className="artist-menu-add"
                type="button"
                onClick={() => selectArtist(ADD_ARTIST_VALUE)}
              >
                + Add artist
              </button>
            </div>
          </details>
        </header>

        {isArtistOnboardingOpen ? (
          <div className="artist-onboarding-backdrop" role="presentation">
            <section className="artist-onboarding" aria-label="Add artist">
              <div className="artist-onboarding-header">
                <div>
                  <p className="eyebrow">Artist onboarding</p>
                  <h2>Add an artist from Chartmetric</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close artist onboarding"
                  onClick={() => setIsArtistOnboardingOpen(false)}
                >
                  x
                </button>
              </div>

              <form className="artist-search-form" onSubmit={searchArtists}>
                <input
                  autoFocus
                  value={artistSearchQuery}
                  onChange={(event) => setArtistSearchQuery(event.target.value)}
                  placeholder="Search artist name..."
                />
                <button type="submit" disabled={isArtistSearching}>
                  {isArtistSearching ? "Searching" : "Search"}
                </button>
              </form>

              <div className="artist-results">
                {artistSearchResults.map((result) => (
                  <button
                    key={result.token}
                    type="button"
                    className="artist-result"
                    disabled={isAddingArtist}
                    onClick={() => addArtist(result)}
                  >
                    <span className="avatar-badge">{getInitials(result.name)}</span>
                    <span className="artist-result-main">
                      <span className="artist-result-name">{result.name}</span>
                      <span className="artist-result-meta">
                        {[
                          result.monthlyListeners
                            ? `${result.monthlyListeners.toLocaleString()} monthly listeners`
                            : "",
                          result.careerStage,
                          result.genres?.slice(0, 2).join(", "),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Chartmetric artist"}
                      </span>
                    </span>
                    <span className="artist-result-action">
                      {isAddingArtist ? "Adding" : "Add"}
                    </span>
                  </button>
                ))}
              </div>

              {artistSearchStatus ? <p className="status">{artistSearchStatus}</p> : null}
            </section>
          </div>
        ) : null}

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h2>What should your artist team do next?</h2>
              <p>
                Ask about release strategy, tour priorities, fan activation,
                content, merch, or the metrics behind your next move.
              </p>
              <div className="starter-questions" aria-label="Starter questions">
                {STARTER_QUESTIONS.map((question) => (
                  <button key={question} type="button" onClick={() => setDraft(question)}>
                    {question}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                {message.role === "assistant" ? (
                  <div className="message-role">Ask Artie</div>
                ) : null}
                <MessageContent message={message} />
              </article>
            ))
          )}
          {isSending ? (
            <article className="message assistant pending">
              <div className="message-role">Ask Artie</div>
              <div className="message-content">Working...</div>
            </article>
          ) : null}
        </div>

        <div className="composer-shell">
          {followUpSuggestions.length > 0 && !isSending ? (
            <div className="follow-up-suggestions" aria-label="Suggested follow-up questions">
              {followUpSuggestions.map((question) => (
                <button
                  key={question}
                  type="button"
                  className="follow-up-chip"
                  onClick={() => submitContent(question)}
                  disabled={isSending}
                >
                  {question}
                </button>
              ))}
            </div>
          ) : null}
          <form onSubmit={sendMessage} className="composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask Artie about your next artist move..."
              rows={3}
            />
            <div className="composer-footer">
              <span className="composer-context">
                Using {selectedArtist?.name ?? "selected artist"} data
              </span>
              <button type="submit" disabled={isSending || !draft.trim()}>
                {isSending ? "Sending" : "Send"}
              </button>
            </div>
          </form>
          {status ? <p className="status">{status}</p> : null}
        </div>
      </section>
    </main>
  );
}
