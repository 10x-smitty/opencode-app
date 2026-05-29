export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  created_at: string;
};

export type ChatSession = {
  id: string;
  title: string;
  artist_id?: string | null;
  artist_name?: string | null;
  created_at: string;
};

export type ArtistOption = {
  id: string;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
  socialHandle?: string | null;
};

export type ArtistSearchResult = {
  token: string;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
  monthlyListeners?: number | null;
  careerStage?: string | null;
  socialHandle?: string | null;
};

export type ModelSelection = {
  providerID: string;
  modelID: string;
};

export type OpencodeModel = ModelSelection & {
  providerName: string;
  modelName: string;
  status?: string;
  contextLimit?: number;
  outputLimit?: number;
  isDefault: boolean;
};
