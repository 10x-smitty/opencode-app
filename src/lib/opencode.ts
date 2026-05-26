import { createOpencodeClient } from "@opencode-ai/sdk";
import { getEnv } from "./env";

function getClient() {
  const env = getEnv();
  return createOpencodeClient({
    baseUrl: env.opencodeUrl,
    directory: env.opencodeDirectory,
  });
}

type PartLike = {
  type?: string;
  text?: string;
  content?: string;
};

type ProviderConfig = {
  default?: Record<string, string>;
  providers?: Array<{
    id: string;
    name?: string;
    models?: Record<string, unknown>;
  }>;
};

type ModelConfig = {
  id?: string;
  name?: string;
  status?: string;
  limit?: {
    context?: number;
    output?: number;
  };
};

type ModelSelection = {
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

function extractText(parts: PartLike[]) {
  const textParts = parts.filter((part) => part.type === "text");
  const visibleParts = textParts.length > 0 ? textParts : parts;

  const text = visibleParts
    .map((part) => {
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return text || JSON.stringify(parts, null, 2);
}

export async function createOpencodeSession(title: string) {
  const response = await getClient().session.create({
    body: { title },
  });

  if (response.error) {
    throw new Error(`opencode session create failed: ${JSON.stringify(response.error)}`);
  }

  if (!response.data?.id) {
    throw new Error("opencode session create returned no session id");
  }

  return response.data.id;
}

async function getProviderConfig() {
  const env = getEnv();
  const url = new URL("/config/providers", env.opencodeUrl);
  url.searchParams.set("directory", env.opencodeDirectory);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not inspect opencode providers: ${response.status}`);
  }

  return (await response.json()) as ProviderConfig;
}

async function validateModel(model?: ModelSelection) {
  if (!model) return;

  const config = await getProviderConfig();
  const provider = config.providers?.find((item) => item.id === model.providerID);

  if (!provider) {
    throw new Error(
      `Selected opencode provider "${model.providerID}" is not available. ` +
        "Choose one of the models reported by the opencode service.",
    );
  }

  if (!provider.models?.[model.modelID]) {
    throw new Error(
      `Selected opencode model "${model.modelID}" is not available for provider "${model.providerID}".`,
    );
  }
}

export async function listOpencodeModels() {
  const config = await getProviderConfig();
  const models: OpencodeModel[] = [];

  for (const provider of config.providers ?? []) {
    for (const [modelID, rawModel] of Object.entries(provider.models ?? {})) {
      const model = rawModel as ModelConfig;
      models.push({
        providerID: provider.id,
        modelID,
        providerName: provider.name ?? provider.id,
        modelName: model.name ?? model.id ?? modelID,
        status: model.status,
        contextLimit: model.limit?.context,
        outputLimit: model.limit?.output,
        isDefault: config.default?.[provider.id] === modelID,
      });
    }
  }

  return models.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (a.providerName !== b.providerName) return a.providerName.localeCompare(b.providerName);
    return a.modelName.localeCompare(b.modelName);
  });
}

export async function promptOpencode(sessionId: string, prompt: string, model?: ModelSelection) {
  const env = getEnv();
  await validateModel(model);

  const body = {
    agent: env.opencodeAgent,
    parts: [{ type: "text" as const, text: prompt }],
    ...(model
      ? {
          model: {
            providerID: model.providerID,
            modelID: model.modelID,
          },
        }
      : {}),
  };

  const response = await getClient().session.prompt({
    path: { id: sessionId },
    body,
  });

  if (response.error) {
    const details = {
      sessionId,
      providerID: model?.providerID || "(opencode config)",
      modelID: model?.modelID || "(opencode config)",
      error: response.error,
    };
    console.error("opencode prompt failed", details);
    throw new Error(`opencode prompt failed: ${JSON.stringify(details)}`);
  }

  return extractText((response.data?.parts ?? []) as PartLike[]);
}
