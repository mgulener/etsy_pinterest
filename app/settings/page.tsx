import { saveSettingsAction, syncPinterestBoardsAction } from "./actions";
import { SubmitButton } from "@/app/components/SubmitButton";
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
  let pinterestBoards: PinterestBoard[] = [];
  let pinterestMappings: PinterestBoardMappingRow[] = [];
  let pinterestBoardsUnavailable = false;

  if (settings.pinterestAccessToken) {
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
        <a className="button ghost-button" href="/api/auth/etsy/start">
          Connect Etsy
        </a>
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

      <form action={saveSettingsAction} className="settings-form">
        <section className="settings-section">
          <div>
            <h2>Etsy</h2>
            <p>Use the Etsy developer keystring, shared secret, and callback URL for this user&apos;s shop connection.</p>
          </div>
          <div className="settings-grid">
            <label>
              Etsy keystring and shared secret
              <input name="etsyApiKey" defaultValue={value(settings.etsyApiKey)} placeholder="keystring:shared_secret" />
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
            <p>OAuth credentials and the board used when Pinterest queue items are published.</p>
          </div>
          <div className="settings-grid">
            <label className="checkbox-field">
              <input name="pinterestEnabled" type="checkbox" defaultChecked={settings.pinterestEnabled} />
              Enable Pinterest queueing
            </label>
            <label>
              Pinterest App ID
              <input name="pinterestAppId" defaultValue={value(settings.pinterestAppId)} placeholder="1609654" />
            </label>
            <label>
              Pinterest App secret
              <input name="pinterestAppSecret" type="password" defaultValue={value(settings.pinterestAppSecret)} placeholder="Pinterest App secret" />
            </label>
            <label>
              Pinterest redirect URI
              <input name="pinterestRedirectUri" defaultValue={value(settings.pinterestRedirectUri)} placeholder="https://etsy-pinterest.vercel.app/api/auth/pinterest/callback" />
            </label>
            <label>
              Board
              {pinterestBoards.length > 0 ? (
                <select name="pinterestBoardId" defaultValue={value(settings.pinterestBoardId)}>
                  <option value="">Select a Pinterest board</option>
                  {settings.pinterestBoardId && !pinterestBoards.some((board) => board.id === settings.pinterestBoardId) ? (
                    <option value={settings.pinterestBoardId}>{settings.pinterestBoardId}</option>
                  ) : null}
                  {pinterestBoards.map((board) => (
                    <option key={board.id} value={board.id}>{board.name}</option>
                  ))}
                </select>
              ) : (
                <input name="pinterestBoardId" defaultValue={value(settings.pinterestBoardId)} placeholder="Available after Pinterest connection" />
              )}
            </label>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {canConnectPinterest ? (
                <a className="btn btn-outline-danger" href="/api/auth/pinterest/start">
                  {settings.pinterestAccessToken ? "Reconnect Pinterest" : "Connect Pinterest"}
                </a>
              ) : (
                <span className="text-secondary">Save the App ID, secret, and redirect URI before connecting.</span>
              )}
              {settings.pinterestAccessToken ? <span className="badge text-bg-success">Connected</span> : null}
              {pinterestBoardsUnavailable ? <span className="text-danger">Boards could not be loaded. Reconnect Pinterest.</span> : null}
            </div>
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
              <input name="instagramAccessToken" defaultValue={value(settings.instagramAccessToken)} placeholder="Instagram access token" />
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
              <input name="openaiApiKey" defaultValue={value(settings.openaiApiKey)} placeholder="sk-..." />
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

      {settings.pinterestAccessToken ? (
        <form action={syncPinterestBoardsAction} className="settings-form mt-3">
          <section className="settings-section">
            <div>
              <h2>Board Mapping</h2>
              <p>Create or match one Pinterest board for every Etsy shop section, then route existing products to the correct board.</p>
            </div>
            <div>
              <div className="d-flex align-items-center gap-2 mb-3">
                <SubmitButton className="btn btn-danger" pendingText="Preparing Pinterest boards...">
                  Sync Etsy Sections &amp; Build Queue
                </SubmitButton>
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
        </form>
      ) : null}
    </main>
  );
}
