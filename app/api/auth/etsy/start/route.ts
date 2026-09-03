import { redirect } from "next/navigation";
import { requireAdminRequest } from "@/lib/auth/session";
import { createEtsyAuthorizationUrl } from "@/lib/etsy/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  redirect((await createEtsyAuthorizationUrl(request)).toString());
}
