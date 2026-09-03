import { validateCronRequest } from "@/lib/auth/cron";
import { syncEtsyListings } from "@/lib/services/syncEtsyListings";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const result = await syncEtsyListings();
  return Response.json(result);
}
