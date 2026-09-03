import { requireAdminRequest } from "@/lib/auth/session";
import { publishPins } from "@/lib/services/publishPins";

export const dynamic = "force-dynamic";

export async function POST() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishPins();
  return Response.json(result);
}
