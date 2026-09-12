import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth/session";
import { createEtsyAuthorizationUrl } from "@/lib/etsy/auth";
import { EtsyConsentError } from "@/lib/etsy/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  redirect((await createEtsyAuthorizationUrl(request)).toString());
}

export async function POST(request: Request) {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  try {
    return NextResponse.redirect(await createEtsyAuthorizationUrl(request), 303);
  } catch (error) {
    if (error instanceof EtsyConsentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("[ETSY_OAUTH] Write permission connection failed", error);
    return NextResponse.redirect(new URL("/settings?etsy=error", request.url), 303);
  }
}
