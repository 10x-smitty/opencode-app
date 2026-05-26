import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getChartmetricConfigStatus } from "@/lib/chartmetric";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return NextResponse.json(getChartmetricConfigStatus());
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chartmetric status request failed" },
      { status: 500 },
    );
  }
}
