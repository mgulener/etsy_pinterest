import { getServerEnv } from "@/lib/config/env";

export function validateCronRequest(request: Request) {
  const env = getServerEnv();
  const authHeader = request.headers.get("authorization");
  const cronHeader = request.headers.get("x-cron-secret");

  if (authHeader === `Bearer ${env.cronSecret}` || cronHeader === env.cronSecret) {
    return null;
  }

  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
