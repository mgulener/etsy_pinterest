import { requireAdminRequest } from "@/lib/auth/session";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";

export const dynamic = "force-dynamic";

export async function POST() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishPinterestPins();
  return Response.json(result);
}
