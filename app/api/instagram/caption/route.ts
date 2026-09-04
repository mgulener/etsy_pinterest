import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/session";
import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import { generateInstagramCaptionWithAI } from "@/lib/instagram/aiCaption";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown caption error";
}

export async function POST(request: Request) {
  await requireAdminSession();

  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : "";

    if (!id) {
      return NextResponse.json({ error: "Missing queue item." }, { status: 400 });
    }

    const settings = await getCurrentUserSettings();

    if (!settings.aiCaptionsEnabled) {
      return NextResponse.json({ error: "AI captions are disabled. Enable them in Settings first." }, { status: 400 });
    }

    const { data: item, error } = await getSupabaseAdmin()
      .from("instagram_queue")
      .select("title, description, destination_url")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read Instagram queue item: ${error.message}`);
    }

    if (!item) {
      return NextResponse.json({ error: "Instagram queue item was not found." }, { status: 404 });
    }

    const caption = await generateInstagramCaptionWithAI({
      listing: {
        title: item.title,
        description: item.description,
        destinationUrl: item.destination_url
      },
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel
    });

    return NextResponse.json({ caption });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
