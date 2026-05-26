import { jwtVerify } from "jose";
import { getEnv } from "./env";

export type AuthUser = {
  id: string;
  email?: string;
};

export async function requireUser(request: Request): Promise<AuthUser> {
  const secret = new TextEncoder().encode(getEnv().jwtSecret);
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!token) {
    throw new Response("Missing bearer token", { status: 401 });
  }

  try {
    const issuer = getEnv().jwtIssuer;
    const { payload } = await jwtVerify(token, secret, issuer ? { issuer } : undefined);

    if (!payload.sub) {
      throw new Error("JWT is missing subject");
    }

    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  } catch {
    throw new Response("Invalid bearer token", { status: 401 });
  }
}
