import { saveSettingsAction } from "./actions";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { getSettingsForUser } from "@/lib/repositories/userSettingsRepository";

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
            <p>Token and board target used when Pinterest queue items are published.</p>
          </div>
          <div className="settings-grid">
            <label className="checkbox-field">
              <input name="pinterestEnabled" type="checkbox" defaultChecked={settings.pinterestEnabled} />
              Enable Pinterest queueing
            </label>
            <label>
              Access token
              <input name="pinterestAccessToken" defaultValue={value(settings.pinterestAccessToken)} placeholder="Pinterest access token" />
            </label>
            <label>
              Board ID
              <input name="pinterestBoardId" defaultValue={value(settings.pinterestBoardId)} placeholder="Pinterest board ID" />
            </label>
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
              <select name="instagramPostMode" defaultValue={settings.instagramPostMode}>
                <option value="single">Single image</option>
                <option value="carousel">Carousel when possible</option>
              </select>
            </label>
            <label>
              Meta API version
              <input name="metaApiVersion" defaultValue={value(settings.metaApiVersion)} placeholder="v25.0" />
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
    </main>
  );
}
