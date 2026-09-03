import { validateCronRequest } from "@/lib/auth/cron";
import { publishPins } from "@/lib/services/publishPins";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishPins();
  return Response.json(result);
}
