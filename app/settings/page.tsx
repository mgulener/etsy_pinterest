import {
  createPinterestSandboxBoardAction,
  redistributePinterestQueueAction,
  saveSettingsAction,
  syncPinterestBoardsAction,
  testPinterestSandboxPinAction
} from "./actions";
import { SubmitButton } from "@/app/components/SubmitButton";
import { EtsyPermissions } from "./EtsyPermissions";
import { hasEtsyListingWriteAccess } from "@/lib/etsy/oauth";
import { requireAdminSession } from "@/lib/auth/session";
import { listPinterestBoards, type PinterestBoard } from "@/lib/pinterest/client";
import { getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { createPinterestBoardMappingsRepository } from "@/lib/repositories/pinterestBoardMappingsRepository";
import type { PinterestBoardMappingRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function value(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const item = params[key];
  return Array.isArray(item) ? item[0] : item;
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  const settings = await getSettingsForUser(session.userId);
  const params = (await searchParams) ?? {};
  const saved = getParam(params, "saved") === "1";
  const etsyStatus = getParam(params, "etsy");
  const etsyWarning = getParam(params, "warning");
  const pinterestStatus = getParam(params, "pinterest");
  const pinterestSetup = getParam(params, "pinterestSetup");
  const createdBoards = getParam(params, "createdBoards") ?? "0";
  const queuedListings = getParam(params, "queued") ?? "0";
  const pinterestRedistribution = getParam(params, "pinterestRedistribution");
  const reviewedListings = getParam(params, "reviewed") ?? "0";
  const movedListings = getParam(params, "moved") ?? "0";
  const fallbackListings = getParam(params, "fallback") ?? "0";
  const pinterestSandboxTest = getParam(params, "pinterestSandboxTest");
  const pinterestSandboxBoard = getParam(params, "pinterestSandboxBoard");
  const sandboxBoardId = getParam(params, "board");
  const sandboxTestListing = getParam(params, "listing");
  const sandboxTestPin = getParam(params, "pin");
  let pinterestBoards: PinterestBoard[] = [];
  let pinterestMappings: PinterestBoardMappingRow[] = [];
  let pinterestBoardsUnavailable = false;

  const hasActivePinterestToken = settings.pinterestEnvironment === "sandbox"
    ? Boolean(settings.pinterestSandboxAccessToken)
    : Boolean(settings.pinterestAccessToken);

  if (hasActivePinterestToken) {
    try {
      pinterestBoards = await listPinterestBoards(session.userId);
    } catch (error) {
      pinterestBoardsUnavailable = true;
      console.error("[PINTEREST_SETTINGS] Board discovery failed", error);
    }
  }

  try {
    pinterestMappings = await createPinterestBoardMappingsRepository().listForUser(session.userId);
  } catch (error) {
    console.error("[PINTEREST_SETTINGS] Board mappings could not be loaded", error);
  }

  const canConnectPinterest = Boolean(
    settings.pinterestAppId && settings.pinterestAppSecret && settings.pinterestRedirectUri
  );

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>Connected account and publishing credentials for {session.email}.</p>
        </div>
      </div>

      {saved ? <section className="alert alert-success" role="alert">Settings saved.</section> : null}
      {etsyStatus === "error" ? (
        <section className="alert alert-danger" role="alert">Etsy connection failed. Check your Etsy keystring and shared secret, then try again.</section>
      ) : null}
      {etsyWarning === "shop-id" ? (
        <section className="alert alert-warning" role="alert">Etsy connected, but the shop ID could not be detected automatically. Enter the Etsy shop ID manually and save settings.</section>
      ) : null}
      {etsyStatus === "connected" && !etsyWarning ? (
        <section className="alert alert-success" role="alert">Etsy connected successfully.</section>
      ) : null}
      {pinterestStatus === "connected" ? (
        <section className="alert alert-success" role="alert">Pinterest connected successfully. Save settings, then sync Etsy sections to prepare the boards and queue.</section>
      ) : null}
      {pinterestStatus === "error" ? (
        <section className="alert alert-danger" role="alert">Pinterest connection failed. Check the App ID, secret, and exact redirect URI, then try again.</section>
      ) : null}
      {pinterestSandboxTest === "ready" ? (
        <section className="alert alert-success" role="alert">
          Sandbox test Pin {sandboxTestPin} was created from Etsy listing {sandboxTestListing}. The production queue was not changed.
        </section>
      ) : null}
      {pinterestSandboxTest === "error" ? (
        <section className="alert alert-danger" role="alert">
          Sandbox test Pin failed. Confirm the Sandbox token and board ID, then try again.
        </section>
      ) : null}
      {pinterestSandboxBoard === "ready" ? (
        <section className="alert alert-success" role="alert">
          Sandbox test board is ready. Board ID: {sandboxBoardId}
        </section>
      ) : null}
      {pinterestSandboxBoard === "error" ? (
        <section className="alert alert-danger" role="alert">
          Sandbox board could not be created. Confirm the Sandbox token and try again.
        </section>
      ) : null}
      {pinterestSetup === "ready" ? (
        <section className="alert alert-success" role="alert">
          Pinterest boards are ready. Created {createdBoards} boards and added {queuedListings} listings to the queue.
        </section>
      ) : null}
      {pinterestSetup === "error" ? (
        <section className="alert alert-danger" role="alert">
          Pinterest board setup failed. Confirm that migration 0019 is applied and reconnect Pinterest if needed.
        </section>
      ) : null}
      {pinterestRedistribution === "ready" ? (
        <section className="alert alert-success" role="alert">
          Reviewed {reviewedListings} fallback listings. Moved {movedListings} to related boards and kept {fallbackListings} in All Products.
        </section>
      ) : null}
      {pinterestRedistribution === "error" ? (
        <section className="alert alert-danger" role="alert">
          Pinterest board classification failed. Check the OpenAI setting and try again.
        </section>
      ) : null}

      <EtsyPermissions
        connected={Boolean(settings.etsyAccessToken)}
        scopeKnown={settings.etsyTokenScope !== null}
        writeAccess={Boolean(settings.etsyAccessToken) && hasEtsyListingWriteAccess(settings.etsyTokenScope)}
        canConnect={Boolean(settings.etsyApiKey)}
      />

      <form action={saveSettingsAction} className="settings-form">
        <section className="settings-section">
          <div>
            <h2>Etsy</h2>
            <p>Use the Etsy developer keystring, shared secret, and callback URL for this user&apos;s shop connection.</p>
          </div>
          <div className="settings-grid">
            <label>
              Etsy keystring and shared secret
              <input
                name="etsyApiKey"
                type="password"
                autoComplete="off"
                placeholder={settings.etsyApiKey ? "Etsy credentials saved; leave blank to keep them" : "keystring:shared_secret"}
              />
            </label>
            <label>
              Etsy redirect URI
              <input name="etsyRedirectUri" defaultValue={value(settings.etsyRedirectUri)} placeholder="https://your-app.vercel.app/api/auth/etsy/callback" />
            </label>
            <label>
              Etsy shop ID
              <input name="etsyShopId" defaultValue={value(settings.etsyShopId)} placeholder="Saved after OAuth, editable if needed" />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div>
            <h2>Pinterest</h2>
            <p>Production OAuth credentials and isolated Sandbox test credentials.</p>
          </div>
          <div className="settings-grid">
            <label className="checkbox-field">
              <input name="pinterestEnabled" type="checkbox" defaultChecked={settings.pinterestEnabled} />
              Enable Pinterest queueing
            </label>
            <label>
              API environment
              <select name="pinterestEnvironment" defaultValue={settings.pinterestEnvironment}>
                <option value="production">Production</option>
                <option value="sandbox">Sandbox</option>
              </select>
            </label>
            <label>
              Pinterest App ID
              <input name="pinterestAppId" defaultValue={value(settings.pinterestAppId)} placeholder="1609654" />
            </label>
            <label>
              Pinterest App secret
              <input
                name="pinterestAppSecret"
                type="password"
                autoComplete="off"
                placeholder={settings.pinterestAppSecret ? "Pinterest secret saved; leave blank to keep it" : "Pinterest App secret"}
              />
            </label>
            <label>
              Pinterest redirect URI
              <input name="pinterestRedirectUri" defaultValue={value(settings.pinterestRedirectUri)} placeholder="https://etsy-pinterest.vercel.app/api/auth/pinterest/callback" />
            </label>
            <label>
              Production board
              {settings.pinterestEnvironment === "production" && pinterestBoards.length > 0 ? (
                <select name="pinterestBoardId" defaultValue={value(settings.pinterestBoardId)}>
                  <option value="">Select a production board</option>
                  {settings.pinterestBoardId && !pinterestBoards.some((board) => board.id === settings.pinterestBoardId) ? (
                    <option value={settings.pinterestBoardId}>{settings.pinterestBoardId}</option>
                  ) : null}
                  {pinterestBoards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              ) : (
                <input name="pinterestBoardId" defaultValue={value(settings.pinterestBoardId)} placeholder="Production board ID" />
              )}
            </label>
            <label>
              Sandbox access token
              <input
                name="pinterestSandboxAccessToken"
                type="password"
                autoComplete="off"
                placeholder={settings.pinterestSandboxAccessToken ? "Sandbox token saved; leave blank to keep it" : "Paste the Sandbox token"}
              />
            </label>
            <label>
              Sandbox board
              {settings.pinterestEnvironment === "sandbox" && pinterestBoards.length > 0 ? (
                <select name="pinterestSandboxBoardId" defaultValue={value(settings.pinterestSandboxBoardId)}>
                  <option value="">Select a Sandbox board</option>
                  {settings.pinterestSandboxBoardId && !pinterestBoards.some((board) => board.id === settings.pinterestSandboxBoardId) ? (
                    <option value={settings.pinterestSandboxBoardId}>{settings.pinterestSandboxBoardId}</option>
                  ) : null}
                  {pinterestBoards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              ) : (
                <input name="pinterestSandboxBoardId" defaultValue={value(settings.pinterestSandboxBoardId)} placeholder="Available after saving the Sandbox token" />
              )}
            </label>
            {settings.pinterestSandboxAccessToken ? (
              <label className="checkbox-field">
                <input name="clearPinterestSandboxAccessToken" type="checkbox" />
                Clear saved Sandbox token
              </label>
            ) : null}
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {canConnectPinterest ? (
                <a className="btn btn-outline-danger" href="/api/auth/pinterest/start">
                  {settings.pinterestAccessToken ? "Reconnect Pinterest" : "Connect Pinterest"}
                </a>
              ) : (
                <span className="text-secondary">Save the App ID, secret, and redirect URI before connecting.</span>
              )}
              {settings.pinterestAccessToken ? <span className="badge text-bg-success">Production connected</span> : null}
              {settings.pinterestSandboxAccessToken ? <span className="badge text-bg-warning">Sandbox token saved</span> : null}
              {pinterestBoardsUnavailable ? (
                <span className="text-danger">
                  {settings.pinterestEnvironment === "sandbox"
                    ? "Sandbox boards could not be loaded. Check the token or enter the board ID manually."
                    : "Boards could not be loaded. Reconnect Pinterest."}
                </span>
              ) : null}
            </div>
            {settings.pinterestEnvironment === "sandbox" ? (
              <div className="alert alert-warning mb-0" role="alert">
                Automated Pinterest publishing is paused in Sandbox mode. Sandbox tests never consume production queue items.
              </div>
            ) : null}
          </div>
        </section>

        <section className="settings-section">
          <div>
            <h2>Instagram</h2>
            <p>Meta/Instagram publishing credentials and default media behavior.</p>
          </div>
          <div className="settings-grid">
            <label className="checkbox-field">
              <input name="instagramEnabled" type="checkbox" defaultChecked={settings.instagramEnabled} />
              Enable Instagram queueing
            </label>
            <label>
              Access token
              <input
                name="instagramAccessToken"
                type="password"
                autoComplete="off"
                placeholder={settings.instagramAccessToken ? "Instagram token saved; leave blank to keep it" : "Instagram access token"}
              />
            </label>
            <label>
              Instagram account ID
              <input name="instagramAccountId" defaultValue={value(settings.instagramAccountId)} placeholder="IG professional account ID" />
            </label>
            <label>
              Instagram user ID
              <input name="instagramUserId" defaultValue={value(settings.instagramUserId)} placeholder="Fallback user ID" />
            </label>
            <label>
              Default post mode
              <input name="instagramPostMode" value="single" readOnly />
            </label>
            <label>
              Meta API version
              <input name="metaApiVersion" defaultValue={value(settings.metaApiVersion)} placeholder="v25.0" />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div>
            <h2>AI Captions</h2>
            <p>Generate product-specific Instagram captions and hashtags before publishing.</p>
          </div>
          <div className="settings-grid">
            <label className="checkbox-field">
              <input name="aiCaptionsEnabled" type="checkbox" defaultChecked={settings.aiCaptionsEnabled} />
              Enable AI caption suggestions
            </label>
            <label>
              OpenAI API key
              <input
                name="openaiApiKey"
                type="password"
                autoComplete="off"
                placeholder={settings.openaiApiKey ? "OpenAI key saved; leave blank to keep it" : "sk-..."}
              />
            </label>
            <label>
              OpenAI model
              <input name="openaiModel" defaultValue={value(settings.openaiModel)} placeholder="gpt-5.4-mini" />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div>
            <h2>Run Controls</h2>
            <p>Queue limits, retry counts, and dry-run behavior for this user.</p>
          </div>
          <div className="settings-grid compact-settings-grid">
            <label className="checkbox-field">
              <input name="dryRun" type="checkbox" defaultChecked={settings.dryRun} />
              Dry run mode
            </label>
            <label>
              Max pins per run
              <input name="maxPinsPerRun" type="number" min="1" defaultValue={value(settings.maxPinsPerRun)} />
            </label>
            <label>
              Pinterest retries
              <input name="maxPinRetries" type="number" min="1" defaultValue={value(settings.maxPinRetries)} />
            </label>
            <label>
              Max Instagram posts per run
              <input name="maxInstagramPostsPerRun" type="number" min="1" defaultValue={value(settings.maxInstagramPostsPerRun)} />
            </label>
            <label>
              Instagram retries
              <input name="maxInstagramRetries" type="number" min="1" defaultValue={value(settings.maxInstagramRetries)} />
            </label>
          </div>
        </section>

        <div className="settings-actions">
          <SubmitButton pendingText="Saving settings...">Save Settings</SubmitButton>
        </div>
      </form>

      {settings.pinterestEnvironment === "sandbox" && settings.pinterestSandboxAccessToken ? (
        <section className="settings-section mt-3">
          <div>
            <h2>Sandbox Test</h2>
            <p>Create one real Sandbox Pin from the next pending product without changing its production queue status.</p>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            {!settings.pinterestSandboxBoardId ? (
              <form action={createPinterestSandboxBoardAction}>
                <SubmitButton className="btn btn-outline-warning" pendingText="Creating Sandbox board...">
                  Create Sandbox Test Board
                </SubmitButton>
              </form>
            ) : null}
            {settings.pinterestSandboxBoardId ? (
              <form action={testPinterestSandboxPinAction}>
                <SubmitButton className="btn btn-warning" pendingText="Creating Sandbox Pin...">
                  Publish Sandbox Test Pin
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}

      {settings.pinterestAccessToken && settings.pinterestEnvironment === "production" ? (
        <section className="settings-section mt-3">
          <div>
            <h2>Board Mapping</h2>
            <p>Create or match one Pinterest board for every Etsy shop section, then route existing products to the correct board.</p>
          </div>
          <div>
            <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
              <form action={syncPinterestBoardsAction}>
                <SubmitButton className="btn btn-danger" pendingText="Preparing Pinterest boards...">
                  Sync Etsy Sections &amp; Build Queue
                </SubmitButton>
              </form>
              <form action={redistributePinterestQueueAction}>
                <SubmitButton className="btn ai-button" pendingText="Classifying products...">
                  Distribute All Products With AI
                </SubmitButton>
              </form>
              <span className="text-secondary small">Safe to run again; existing boards and queue items are reused.</span>
            </div>
            {pinterestMappings.length > 0 ? (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Etsy section</th>
                      <th>Pinterest board</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pinterestMappings.map((mapping) => (
                      <tr key={mapping.id}>
                        <td>{mapping.etsy_section_title}</td>
                        <td>{mapping.pinterest_board_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-secondary">No Etsy section mappings have been created yet.</div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
