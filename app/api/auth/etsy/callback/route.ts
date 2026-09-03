import { redirect } from "next/navigation";
import { handleEtsyOAuthCallback } from "@/lib/etsy/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await handleEtsyOAuthCallback(request);
  redirect("/dashboard?etsy=connected");
}
