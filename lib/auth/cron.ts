import { getRequiredEnv } from "@/lib/config/env";

export function validateCronRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");
  const cronSecret = getRequiredEnv("CRON_SECRET");

  if (authHeader === `Bearer ${cronSecret}` || cronHeader === cronSecret) {
    return null;
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
