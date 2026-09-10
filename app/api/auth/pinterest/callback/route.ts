import { NextResponse } from "next/server";
import { handlePinterestOAuthCallback } from "@/lib/pinterest/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await handlePinterestOAuthCallback(request);
    return NextResponse.redirect(new URL("/settings?pinterest=connected", request.url));
  } catch (error) {
    console.error("[PINTEREST_OAUTH] Callback failed", error);
    return NextResponse.redirect(new URL("/settings?pinterest=error", request.url));
  }
}
