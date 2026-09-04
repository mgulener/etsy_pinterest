import { getCurrentSession, requireAdminRequest } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireAdminRequest();

  if (unauthorized) {
    return unauthorized;
  }

  const session = await getCurrentSession();

  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null) as { jobId?: unknown } | null;
  const jobId = typeof body?.jobId === "string" ? body.jobId : null;

  if (!jobId) {
    return Response.json({ error: "Missing jobId" }, { status: 400 });
  }

  await createAppSettingsRepository().dismissProgressJobForUser(session.userId, jobId);
  return Response.json({ ok: true });
}
