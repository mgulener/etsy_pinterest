import { validateCronRequest } from "@/lib/auth/cron";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);

  if (unauthorized) {
    return unauthorized;
  }

  const result = await publishInstagramPosts();
  return Response.json(result);
}
