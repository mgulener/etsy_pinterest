import { validateCronRequest } from "@/lib/auth/cron";
import { publishInstagram } from "@/lib/services/publishInstagram";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishInstagram();
  return Response.json(result);
}
