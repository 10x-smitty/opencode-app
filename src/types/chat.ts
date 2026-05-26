export type ChatRole = "user" | "assistant" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  created_at: string;
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
