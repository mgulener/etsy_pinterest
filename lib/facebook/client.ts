import { FacebookError, FacebookTokenError, type FacebookSettings } from "./types";
import { validateFacebookMedia, validateFacebookMessage } from "./content";

type Credentials = Pick<FacebookSettings, "page_id" | "page_access_token" | "api_version">;

function validateCredentials(settings: Credentials) {
  if (!/^\d+$/.test(settings.page_id) || !/^v\d+\.0$/.test(settings.api_version) || !settings.page_access_token.trim()) {
    throw new FacebookError("Enter a Page ID, Page access token and Meta API version.");
  }
}

async function graphRequest(settings: Credentials, path: string, body?: URLSearchParams, fetcher: typeof fetch = fetch) {
  validateCredentials(settings);
  let response: Response;
  let data: Record<string, unknown>;
  try {
    response = await fetcher(`https://graph.facebook.com/${settings.api_version}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${settings.page_access_token}` },
      body,
      signal: AbortSignal.timeout(body ? 90_000 : 15_000),
      cache: "no-store",
      redirect: "error"
    });
    data = await response.json();
    if (!data || typeof data !== "object") throw new Error("Invalid response");
  } catch {
    throw new FacebookError(body
      ? "Facebook response was not confirmed. Check the Page before attempting another publication."
      : "Facebook connection could not be verified. Check the Page token and try again.", Boolean(body), Boolean(body));
  }
  if (!response.ok || data.error) {
    const code = typeof data.error === "object" && data.error !== null && "code" in data.error
      ? Number(data.error.code) : 0;
    // Never include upstream messages: they can echo credentials or request content.
    if (code === 190 && !response.ok && response.status < 500) {
      const subcode = typeof data.error === "object" && data.error !== null && "error_subcode" in data.error
        ? Number(data.error.error_subcode) : 0;
      throw new FacebookTokenError(subcode === 463);
    }
    const ambiguous = Boolean(body) && (response.status >= 500 || response.ok);
    const pause = ambiguous || [4, 10, 17, 32, 190, 200, 613].includes(code) || response.status === 429;
    throw new FacebookError(`Facebook request failed (HTTP ${response.status}, code ${code}). ${ambiguous
      ? "Publication needs review; do not retry automatically."
      : "Check Page permissions, token validity and account restrictions."}`, ambiguous, pause);
  }
  return data;
}

export async function verifyFacebookPage(settings: Credentials, fetcher: typeof fetch = fetch) {
  const data = await graphRequest(settings, "me?fields=id,name", undefined, fetcher);
  if (data.id !== settings.page_id || typeof data.name !== "string") {
    throw new FacebookError("The Page token does not match this Page ID. Use a Page access token, not an Instagram or user token.");
  }
  return { id: data.id as string, name: data.name };
}

export async function createFacebookPhoto(settings: Credentials, input: {
  message: string; imageUrl: string; destinationUrl: string;
}, fetcher: typeof fetch = fetch) {
  const message = validateFacebookMessage(input.message);
  validateFacebookMedia(input.imageUrl, input.destinationUrl);
  const data = await graphRequest(settings, `${settings.page_id}/photos`, new URLSearchParams({
    url: input.imageUrl,
    message: `${message}\n\n${input.destinationUrl}`,
    published: "true"
  }), fetcher);
  if (typeof data.post_id !== "string" || !new RegExp(`^${settings.page_id}_\\d+$`).test(data.post_id)) {
    throw new FacebookError("Facebook accepted the photo but did not confirm a Page post ID. Review the Page; no automatic retry.", true, true);
  }
  return { postId: data.post_id };
}
