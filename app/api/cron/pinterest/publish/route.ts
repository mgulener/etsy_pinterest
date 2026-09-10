import { validateCronRequest } from "@/lib/auth/cron";
import { getPinterestAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const userId = await getPinterestAutomationUserId();

  if (!userId) {
    return Response.json({ error: "No Pinterest automation user configured" }, { status: 409 });
  }

  const result = await publishPinterestPins(userId);
  return Response.json(result);
}
