"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUp,
  LayoutDashboard,
  MapPin,
  PanelLeft,
  Pin,
  Plug,
  Settings,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  SiInstagram,
  SiSpotify,
  SiTiktok,
  SiYoutube,
} from "@icons-pack/react-simple-icons";
import { ResponseWidget } from "@/components/ResponseWidgets";
import { markdownComponents } from "@/components/MarkdownComponents";
import { extractSuggestions, splitMessageWidgets } from "@/lib/widgets";
import type {
  ArtistOption,
  ArtistProfile,
  ArtistSearchResult,
  ChatMessage,
  ChatSession,
} from "@/types/chat";

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

type DataSourceOption = {
  key: string;
  label: string;
  connected: boolean;
};

const DATA_SOURCES: DataSourceOption[] = [
  { key: "spotify", label: "Spotify for Artists", connected: false },
  { key: "instagram", label: "Instagram", connected: false },
  { key: "tiktok", label: "TikTok", connected: false },
  { key: "youtube", label: "YouTube", connected: false },
];

const STARTER_QUESTIONS = [
  "Where should I tour?",
  "What content works best?",
  "Who are my influential fans?",
  "Playlist activity",
];

function formatBreadcrumbDate(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${mm}-${dd}-${yy}`;
}

function formatRelativeTime(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  if (years >= 1) return `${years}y`;
  if (months >= 1) return `${months}mo`;
  if (weeks >= 1) return `${weeks}w`;
  if (days >= 1) return `${days}d`;
  if (hours >= 1) return `${hours}h`;
  if (minutes >= 1) return `${minutes}m`;
  return "now";
}

function formatStatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function ArtistAvatar({
  name,
  imageUrl,
  className,
}: {
  name?: string | null;
  imageUrl?: string | null;
  className?: string;
}) {
  const classes = ["avatar-badge", className].filter(Boolean).join(" ");
  if (imageUrl) {
    return (
      <span className={`${classes} avatar-badge--image`}>
        <img src={imageUrl} alt="" />
      </span>
    );
  }
  return <span className={classes}>{getInitials(name)}</span>;
}

function sanitizeBioHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

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
  const [artists, setArtists] = useState<ArtistOption[]>([]);
  const [selectedArtistId, setSelectedArtistId] = useState("");
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProfilePanelOpen, setIsProfilePanelOpen] = useState(false);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const selectedArtist = artists.find((artist) => artist.id === selectedArtistId);
  const activeChatSession = chatSessions.find((item) => item.id === activeSessionId);
  const followUpSuggestions = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role !== "assistant") continue;
      const found = extractSuggestions(message.content);
      if (found.length) return found.slice(0, 3);
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
        const nextArtists = data.artists;
        setArtists(nextArtists);
        setSelectedArtistId((current) => {
          if (nextArtists.some((artist) => artist.id === current)) return current;
          return nextArtists[0]?.id ?? "";
        });
      })
      .catch((error: Error) => setStatus(error.message));
  }, [authHeaders]);

  useEffect(() => {
    setArtistProfile(null);
    setProfileError("");

    if (!authHeaders || !selectedArtistId) {
      setIsLoadingProfile(false);
      return;
    }

    let cancelled = false;
    setIsLoadingProfile(true);

    fetch(`/api/artists/${encodeURIComponent(selectedArtistId)}/profile`, {
      headers: authHeaders,
    })
      .then(async (response) => {
        const data = (await response.json()) as { profile?: ArtistProfile; error?: string };
        if (!response.ok || !data.profile) {
          throw new Error(data.error ?? "Could not load artist profile");
        }
        return data.profile;
      })
      .then((profile) => {
        if (!cancelled) setArtistProfile(profile);
      })
      .catch((error: Error) => {
        if (!cancelled) setProfileError(error.message);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingProfile(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authHeaders, selectedArtistId]);

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

  function sortChatSessions(list: ChatSession[]) {
    return [...list].sort((a, b) => {
      const aArchived = a.archived_at ? 1 : 0;
      const bArchived = b.archived_at ? 1 : 0;
      if (aArchived !== bArchived) return aArchived - bArchived;
      const aPinned = a.pinned_at ? 0 : 1;
      const bPinned = b.pinned_at ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      if (a.pinned_at && b.pinned_at) {
        return new Date(b.pinned_at).getTime() - new Date(a.pinned_at).getTime();
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }

  async function patchChatSession(
    chatSession: ChatSession,
    patch: { pinned?: boolean; archived?: boolean },
  ) {
    if (!authHeaders) return;

    const previous = chatSessions;
    const optimistic: ChatSession = {
      ...chatSession,
      ...(patch.pinned !== undefined
        ? { pinned_at: patch.pinned ? new Date().toISOString() : null }
        : {}),
      ...(patch.archived !== undefined
        ? {
            archived_at: patch.archived ? new Date().toISOString() : null,
            ...(patch.archived ? { pinned_at: null } : {}),
          }
        : {}),
    };
    setChatSessions((current) =>
      sortChatSessions(current.map((item) => (item.id === chatSession.id ? optimistic : item))),
    );

    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(chatSession.id)}`, {
        method: "PATCH",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await response.json()) as { session?: ChatSession; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error ?? "Could not update chat");
      setChatSessions((current) =>
        sortChatSessions(
          current.map((item) => (item.id === chatSession.id ? { ...item, ...data.session! } : item)),
        ),
      );
    } catch (error) {
      setChatSessions(previous);
      setStatus(error instanceof Error ? error.message : "Could not update chat");
    }
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
    if (!authHeaders || deletingArtistId) return;

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
          setSelectedArtistId(next[0]?.id ?? "");
        }
        return next;
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
      setArtistSearchStatus("Type at least two characters to search.");
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
      setArtistSearchStatus(data.results?.length ? "" : "No artists matched that search.");
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
              <img src="/ask-artie-logo.svg" alt="Ask Artie" width={260} />
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
    <main
      className={`chat-shell ${isSidebarOpen ? "" : "chat-shell--collapsed"} ${
        isProfilePanelOpen ? "chat-shell--has-profile" : ""
      }`}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand-row">
            <img src="/ask-artie-logo.svg" alt="Ask Artie" width={150} />
          </div>
        </div>

        <div className="sidebar-main">
          <button
            className="new-chat-button"
            type="button"
            onClick={() => startNewChat()}
            disabled={isSending}
          >
            <SquarePen size={16} aria-hidden="true" />
            <span>New chat</span>
          </button>

          <section className="sidebar-section">
            <p className="sidebar-label">Chats</p>
            {chatSessions.length === 0 ? (
              <div className="thread-empty">No chats yet</div>
            ) : (
              chatSessions.map((chatSession) => {
                const isPinned = Boolean(chatSession.pinned_at);
                const isDeleting = deletingSessionId === chatSession.id;
                return (
                  <div
                    key={chatSession.id}
                    className={`thread-item ${chatSession.id === activeSessionId ? "active" : ""} ${
                      isPinned ? "thread-item--pinned" : ""
                    }`}
                  >
                    <button
                      className="thread-select"
                      type="button"
                      onClick={() => {
                        setActiveSessionId(chatSession.id);
                        if (
                          chatSession.artist_id &&
                          chatSession.artist_id !== selectedArtistId
                        ) {
                          setSelectedArtistId(chatSession.artist_id);
                        }
                      }}
                    >
                      <span className="thread-title">{chatSession.title}</span>
                      {chatSession.artist_name ? (
                        <span className="thread-subtitle">{chatSession.artist_name}</span>
                      ) : null}
                    </button>
                    <span className="thread-time" aria-label="Last updated">
                      {formatRelativeTime(chatSession.created_at)}
                    </span>
                    <div
                      className="thread-actions"
                      aria-label={`Actions for ${chatSession.title}`}
                    >
                      <button
                        type="button"
                        className={`thread-action ${isPinned ? "is-active" : ""}`}
                        aria-label={`${isPinned ? "Unpin" : "Pin"} ${chatSession.title}`}
                        aria-pressed={isPinned}
                        onClick={() => patchChatSession(chatSession, { pinned: !isPinned })}
                      >
                        <Pin size={12} fill={isPinned ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        className="thread-action thread-action--danger"
                        aria-label={`Delete ${chatSession.title}`}
                        disabled={isDeleting}
                        onClick={() => deleteChatSession(chatSession)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>

        <div className="sidebar-footer">
          <details className="user-menu">
            <summary>
              <span className="avatar-badge avatar-badge--image" aria-hidden="true">
                <img src="/avatar.svg" alt="" />
              </span>
              <span>{session.user.email}</span>
              <Settings size={14} className="menu-settings" aria-hidden="true" />
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
          <button
            type="button"
            className="icon-button chat-header-toggle"
            aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-pressed={isSidebarOpen}
            onClick={() => setIsSidebarOpen((open) => !open)}
          >
            <PanelLeft size={18} />
          </button>
          <nav className="chat-breadcrumb" aria-label="Chat location">
            {activeChatSession ? (
              <>
                <span className="chat-breadcrumb-item">
                  {activeChatSession.artist_name ?? selectedArtist?.name ?? "—"}
                </span>
                <span className="chat-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
                <span className="chat-breadcrumb-item">
                  {formatBreadcrumbDate(activeChatSession.created_at)}
                </span>
                <span className="chat-breadcrumb-sep" aria-hidden="true">
                  /
                </span>
                <span className="chat-breadcrumb-item chat-breadcrumb-title">
                  {activeChatSession.title}
                </span>
              </>
            ) : null}
          </nav>
          <button
            type="button"
            className="icon-button"
            aria-label={isProfilePanelOpen ? "Close artist profile" : "Open artist profile"}
            aria-pressed={isProfilePanelOpen}
            onClick={() => setIsProfilePanelOpen((open) => !open)}
          >
            <LayoutDashboard size={18} />
          </button>
        </header>

        {isArtistOnboardingOpen ? (
          <div className="artist-onboarding-backdrop" role="presentation">
            <section className="artist-onboarding" aria-label="Add artist">
              <div className="artist-onboarding-header">
                <div>
                  <p className="eyebrow">Artist onboarding</p>
                  <h2>Add artist to get started</h2>
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
                    <ArtistAvatar name={result.name} imageUrl={result.imageUrl} />
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
                          .join(" · ") || "Artist"}
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
              <div className="composer-actions">
                {artists.length === 0 ? (
                  <button
                    type="button"
                    className="artist-menu-add artist-menu-add--inline"
                    onClick={() => selectArtist(ADD_ARTIST_VALUE)}
                  >
                    + Add artist
                  </button>
                ) : (
                  <details className="artist-menu artist-menu--up artist-menu--inline">
                    <summary aria-label="Artist">
                      <ArtistAvatar
                        name={selectedArtist?.name}
                        imageUrl={selectedArtist?.imageUrl}
                      />
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
                          <ArtistAvatar name={artist.name} imageUrl={artist.imageUrl} />
                          <span className="artist-menu-copy">
                            <span>{artist.name}</span>
                            {artist.socialHandle ? <span>@{artist.socialHandle}</span> : null}
                          </span>
                        </button>
                        <button
                          className="artist-menu-delete"
                          type="button"
                          aria-label={`Delete ${artist.name}`}
                          disabled={deletingArtistId === artist.id}
                          onClick={() => deleteArtist(artist)}
                        >
                          x
                        </button>
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
                )}
                <details className="artist-menu artist-menu--up artist-menu--inline data-source-menu">
                  <summary aria-label="Data sources">
                    <Plug size={14} aria-hidden="true" />
                    <span>Data sources</span>
                    <span className="menu-caret" />
                  </summary>
                  <div className="artist-menu-popover data-source-popover">
                    {DATA_SOURCES.map((source) => (
                      <button
                        key={source.key}
                        type="button"
                        className="data-source-row"
                      >
                        <span
                          className={`data-source-status ${
                            source.connected ? "is-connected" : "is-disconnected"
                          }`}
                          aria-label={source.connected ? "Connected" : "Not connected"}
                        />
                        <span>{source.label}</span>
                      </button>
                    ))}
                  </div>
                </details>
              </div>
              <button
                type="submit"
                className="composer-send"
                disabled={!isSending && (!draft.trim() || !selectedArtist)}
                aria-label={isSending ? "Stop generating" : "Send message"}
              >
                {isSending ? (
                  <Square size={12} fill="currentColor" aria-hidden="true" />
                ) : (
                  <ArrowUp size={18} aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
          {status ? <p className="status">{status}</p> : null}
        </div>
      </section>

      {isProfilePanelOpen ? (
        <aside className="artist-profile-panel" aria-label="Artist profile">
          <header className="artist-profile-header">
            <span className="artist-profile-eyebrow">Artist</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Close artist profile"
              onClick={() => setIsProfilePanelOpen(false)}
            >
              <X size={16} />
            </button>
          </header>

          {!selectedArtist ? (
            <div className="artist-profile-empty">
              Select an artist to view their profile.
            </div>
          ) : (
            <div className="artist-profile-body">
              <div className="artist-profile-identity">
                <div className="artist-profile-avatar">
                  {artistProfile?.imageUrl || selectedArtist.imageUrl ? (
                    <img
                      src={artistProfile?.imageUrl ?? selectedArtist.imageUrl ?? ""}
                      alt={`${selectedArtist.name} avatar`}
                    />
                  ) : (
                    <span>{getInitials(selectedArtist.name)}</span>
                  )}
                </div>
                <h2 className="artist-profile-name">{selectedArtist.name}</h2>
                {(artistProfile?.socialHandle ?? selectedArtist.socialHandle) ? (
                  <p className="artist-profile-handle">
                    @{artistProfile?.socialHandle ?? selectedArtist.socialHandle}
                  </p>
                ) : null}
              </div>

              <div className="artist-profile-stats">
                <div className="artist-profile-stat">
                  <span className="artist-profile-stat-icon">
                    <SiSpotify size={14} color="#1DB954" />
                  </span>
                  <span className="artist-profile-stat-value">
                    {formatStatNumber(artistProfile?.stats.spotify)}
                  </span>
                  <span className="artist-profile-stat-label">Spotify</span>
                </div>
                <div className="artist-profile-stat">
                  <span className="artist-profile-stat-icon">
                    <SiInstagram size={14} color="#E4405F" />
                  </span>
                  <span className="artist-profile-stat-value">
                    {formatStatNumber(artistProfile?.stats.instagram)}
                  </span>
                  <span className="artist-profile-stat-label">Instagram</span>
                </div>
                <div className="artist-profile-stat">
                  <span className="artist-profile-stat-icon">
                    <SiTiktok size={14} color="#EE1D52" />
                  </span>
                  <span className="artist-profile-stat-value">
                    {formatStatNumber(artistProfile?.stats.tiktok)}
                  </span>
                  <span className="artist-profile-stat-label">TikTok</span>
                </div>
                <div className="artist-profile-stat">
                  <span className="artist-profile-stat-icon">
                    <SiYoutube size={14} color="#FF0000" />
                  </span>
                  <span className="artist-profile-stat-value">
                    {formatStatNumber(artistProfile?.stats.youtube)}
                  </span>
                  <span className="artist-profile-stat-label">YouTube</span>
                </div>
              </div>

              {(artistProfile?.genres.length ?? selectedArtist.genres?.length ?? 0) > 0 ? (
                <section className="artist-profile-section">
                  <span className="artist-profile-section-label">Genre</span>
                  <div className="artist-profile-tags">
                    {(artistProfile?.genres ?? selectedArtist.genres ?? []).map((genre) => (
                      <span key={genre} className="artist-profile-tag">
                        {genre}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {artistProfile?.subgenres.length ? (
                <section className="artist-profile-section">
                  <span className="artist-profile-section-label">Sound</span>
                  <div className="artist-profile-tags">
                    {artistProfile.subgenres.map((tag) => (
                      <span key={tag} className="artist-profile-tag artist-profile-tag--soft">
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="artist-profile-section">
                <span className="artist-profile-section-label">Bio</span>
                {isLoadingProfile && !artistProfile ? (
                  <p className="artist-profile-bio is-loading">Loading bio…</p>
                ) : artistProfile?.bio ? (
                  <div
                    className="artist-profile-bio"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeBioHtml(artistProfile.bio),
                    }}
                  />
                ) : (
                  <p className="artist-profile-bio is-empty">No bio available.</p>
                )}
                {artistProfile?.hometown || artistProfile?.country ? (
                  <div className="artist-profile-meta">
                    <MapPin size={14} aria-hidden="true" />
                    <span>
                      {[artistProfile.hometown, artistProfile.country].filter(Boolean).join(", ")}
                    </span>
                  </div>
                ) : null}
              </section>

              {profileError ? (
                <p className="artist-profile-error">{profileError}</p>
              ) : null}
            </div>
          )}
        </aside>
      ) : null}
    </main>
  );
}
