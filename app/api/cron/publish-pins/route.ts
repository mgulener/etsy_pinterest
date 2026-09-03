import { validateCronRequest } from "@/lib/auth/cron";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishPinterestPins();
  return Response.json(result);
}
