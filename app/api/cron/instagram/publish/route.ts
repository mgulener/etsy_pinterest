import { validateCronRequest } from "@/lib/auth/cron";
import { getInstagramAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { hasRecentSocialPublication } from "@/lib/services/cronCadence";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const userId = await getInstagramAutomationUserId();

  if (!userId) {
    return Response.json({ error: "No Instagram automation user configured" }, { status: 409 });
  }

  try {
    if (await hasRecentSocialPublication("instagram", 15)) {
      return Response.json(
        { mode: "publish-instagram", status: "waiting", reason: "cadence" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const result = await publishInstagramPosts(undefined, userId, { maxPostsPerRun: 1 });
    const failed = result.failed > 0 || result.needsReview > 0;
    return Response.json(result, {
      status: failed ? 502 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json(
      { error: "Instagram scheduled publication failed. Review the queue before retrying." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
