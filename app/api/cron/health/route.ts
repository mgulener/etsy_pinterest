import { validateCronRequest } from "@/lib/auth/cron";
import { evaluateAutomationHealth, readAutomationHealthSnapshot } from "@/lib/services/automationHealth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const unauthorized = validateCronRequest(request);
  if (unauthorized) return unauthorized;

  try {
    const report = evaluateAutomationHealth(await readAutomationHealthSnapshot());
    console.info("[AUTOMATION_HEALTH]", JSON.stringify(report));
    return Response.json(report, {
      status: report.healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return Response.json(
      { healthy: false, error: "Automation health check failed." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
