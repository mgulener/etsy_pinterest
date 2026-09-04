import { NextResponse } from "next/server";
import { handleEtsyOAuthCallback } from "@/lib/etsy/auth";

export const dynamic = "force-dynamic";

function settingsRedirect(request: Request, params: Record<string, string>) {
  const url = new URL("/settings", request.url);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  try {
    const result = await handleEtsyOAuthCallback(request);

    if (!result.shopIdSaved) {
      return settingsRedirect(request, {
        etsy: "connected",
        warning: "shop-id"
      });
    }

    return NextResponse.redirect(new URL("/dashboard?etsy=connected", request.url));
  } catch (error) {
    console.error("[ETSY_OAUTH] Callback failed", error);
    return settingsRedirect(request, {
      etsy: "error"
    });
  }
}
