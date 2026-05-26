"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import type { ChatMessage } from "@/types/chat";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase public environment variables");
}

const supabaseConfig = {
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
};

type ArtistOption = {
  id: string;
  name: string;
  dataLabel: string;
};

const ADD_ARTIST_VALUE = "__add_artist__";
const INITIAL_ARTISTS: ArtistOption[] = [
  {
    id: "caleb-lee-hutchinson",
    name: "Caleb Lee Hutchinson",
    dataLabel: "Caleb test data",
  },
];

const STARTER_QUESTIONS = [
  "What should shape Caleb's next single rollout?",
  "Which cities should we prioritize first?",
  "What content angles fit the current audience signals?",
  "What merch or fan activation should we test next?",
];

export default function Home() {
  const supabase = useMemo(
    () => createClient(supabaseConfig.url, supabaseConfig.anonKey),
    [],
  );

  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("demo@example.com");
  const [password, setPassword] = useState("password123");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [artists, setArtists] = useState<ArtistOption[]>(INITIAL_ARTISTS);
  const [selectedArtistId, setSelectedArtistId] = useState(INITIAL_ARTISTS[0].id);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [isSending, setIsSending] = useState(false);
  const latestMessage = messages.at(-1);
  const selectedArtist = artists.find((artist) => artist.id === selectedArtistId);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setMessages([]);
    });

    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session?.access_token) return;

    fetch("/api/messages", {
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
  }, [session]);

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

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!draft.trim() || !session?.access_token) return;

    const content = draft.trim();
    setDraft("");
    setIsSending(true);
    setStatus("");

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
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
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Chat request failed");

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

  async function startNewChat() {
    if (!session?.access_token) return;

    setStatus("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat/reset", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not start a new chat");

      setMessages([]);
      setDraft("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start a new chat");
    } finally {
      setIsSending(false);
    }
  }

  function selectArtist(value: string) {
    if (value !== ADD_ARTIST_VALUE) {
      setSelectedArtistId(value);
      return;
    }

    const artistName = window.prompt("Artist name");
    const trimmed = artistName?.trim();
    if (!trimmed) return;

    const id = `custom-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    setArtists((current) => {
      if (current.some((artist) => artist.id === id)) return current;
      return [...current, { id, name: trimmed, dataLabel: "No data connected" }];
    });
    setSelectedArtistId(id);
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <section className="auth-panel">
          <div>
            <div className="brand-row">
              <span className="brand-mark">oc</span>
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
            <span className="brand-mark">oc</span>
            <span>Ask Artie</span>
          </div>
        </div>

        <div className="sidebar-main">
          <button
            className="new-chat-button"
            type="button"
            onClick={startNewChat}
            disabled={isSending}
          >
            New chat
          </button>

          <section className="sidebar-section">
            <p className="sidebar-label">Chat</p>
            <button className="thread-item active" type="button">
              <span className="thread-title">
                {latestMessage?.content ?? "Current thread"}
              </span>
              <span className="thread-meta">
                {messages.length ? `${messages.length} messages` : "No messages yet"}
              </span>
            </button>
          </section>
        </div>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="user-avatar">{session.user.email?.[0]?.toUpperCase() ?? "U"}</span>
            <span>{session.user.email}</span>
          </div>
          <button
            className="secondary ghost-button"
            type="button"
            onClick={() => supabase.auth.signOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Chat</h1>
          </div>
          <div className="artist-select-shell">
            <label htmlFor="artist-select">Artist</label>
            <select
              id="artist-select"
              value={selectedArtistId}
              onChange={(event) => selectArtist(event.target.value)}
            >
              {artists.map((artist) => (
                <option key={artist.id} value={artist.id}>
                  {artist.name}
                </option>
              ))}
              <option value={ADD_ARTIST_VALUE}>+ Add artist</option>
            </select>
            {selectedArtist ? <span>{selectedArtist.dataLabel}</span> : null}
          </div>
        </header>

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
                <div className="message-content">{message.content}</div>
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
