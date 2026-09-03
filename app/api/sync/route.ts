import { requireAdminRequest } from "@/lib/auth/session";
import { bootstrapExistingListings } from "@/lib/services/bootstrap";
import { syncEtsyListings } from "@/lib/services/syncEtsyListings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const result =
    body.mode === "bootstrap"
      ? await bootstrapExistingListings()
      : await syncEtsyListings();

  return Response.json(result);
}
