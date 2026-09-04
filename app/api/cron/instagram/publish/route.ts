import { validateCronRequest } from "@/lib/auth/cron";
import { getInstagramAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const userId = await getInstagramAutomationUserId();

  if (!userId) {
    return Response.json({ error: "No Instagram automation user configured" }, { status: 409 });
  }

  const result = await publishInstagramPosts(undefined, userId);
  return Response.json(result);
}
