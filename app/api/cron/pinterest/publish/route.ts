import { validateCronRequest } from "@/lib/auth/cron";
import { getPinterestAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { hasRecentSocialPublication } from "@/lib/services/cronCadence";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const userId = await getPinterestAutomationUserId();

  if (!userId) {
    return Response.json({ error: "No Pinterest automation user configured" }, { status: 409 });
  }

  try {
    if (await hasRecentSocialPublication("pinterest", 15)) {
      return Response.json(
        { mode: "publish", status: "waiting", reason: "cadence" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    const result = await publishPinterestPins(userId, { maxPinsPerRun: 1 });
    const failed = result.failed > 0 || Boolean(result.pausedReason);
    return Response.json(result, {
      status: failed ? 502 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json(
      { error: "Pinterest scheduled publication failed. Review the queue before retrying." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
