import { requireAdminRequest } from "@/lib/auth/session";
import { publishInstagram } from "@/lib/services/publishInstagram";

export const dynamic = "force-dynamic";

export async function POST() {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishInstagram();
  return Response.json(result);
}
