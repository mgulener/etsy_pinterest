import { validateCronRequest } from "@/lib/auth/cron";
import { getEtsyAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { publishFacebookForUser } from "@/lib/services/publishFacebookPosts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const userId = await getEtsyAutomationUserId();
    if (!userId) return Response.json({ status: "disabled" });
    const result = await publishFacebookForUser(userId, true);
    return Response.json(result, { status: ["failed", "needs_review"].includes(result.status) ? 502 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Facebook publication could not be confirmed. Inspect the queue before retrying." }, { status: 500 });
  }
}
