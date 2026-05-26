import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { listOpencodeModels } from "@/lib/opencode";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    const models = await listOpencodeModels();

    return NextResponse.json({
      models,
      defaultModel: models.find((model) => model.isDefault) ?? models[0] ?? null,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json({ error: "Failed to load opencode models" }, { status: 500 });
  }
}
