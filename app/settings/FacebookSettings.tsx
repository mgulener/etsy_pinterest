"use client";

import { useActionState } from "react";
import { Save } from "lucide-react";
import { saveFacebookSettingsAction } from "@/app/facebook/actions";
import type { FacebookSettings as Settings } from "@/lib/facebook/types";

export function FacebookSettings({ available, settings, apiVersion }: {
  available: boolean;
  settings: Omit<Settings, "page_access_token"> | null;
  apiVersion: string;
}) {
  const [state, action, pending] = useActionState(saveFacebookSettingsAction, { ok: false, message: "" });
  return <section className="settings-section mt-4" id="facebook">
    <div><h2>Facebook</h2><span className={`badge ${settings?.enabled ? "text-bg-success" : "text-bg-secondary"}`}>
      {settings?.enabled ? settings.page_name : "Disabled"}
    </span>
    {settings?.enabled ? <span className={`badge ms-2 ${settings.automatic_enabled ? "text-bg-success" : "text-bg-warning"}`}>
      {settings.automatic_enabled ? "Automatic publishing on" : "Automatic publishing paused"}
    </span> : null}</div>
    {!available ? <div className="alert alert-warning mb-0">Facebook storage is not ready. Apply database migration 0023.</div> :
      <form action={action} className="w-100">
        <input type="hidden" name="updatedAt" value={settings?.updated_at ?? ""} />
        <div className="row g-3">
          <div className="col-12 col-lg-6"><label className="form-label" htmlFor="facebook-page">Page ID</label>
            <input className="form-control" id="facebook-page" name="pageId" required pattern="[0-9]+" defaultValue={settings?.page_id ?? ""} /></div>
          <div className="col-12 col-lg-6"><label className="form-label" htmlFor="facebook-token">Page access token</label>
            <input className="form-control" id="facebook-token" name="pageAccessToken" type="password" autoComplete="off" required={!settings}
              placeholder={settings ? "Saved; leave blank to keep" : "Facebook Page access token"} /></div>
          <div className="col-12 col-lg-6"><label className="form-label" htmlFor="facebook-version">Meta API version</label>
            <input className="form-control" id="facebook-version" name="apiVersion" required pattern="v[0-9]+\.0" defaultValue={settings?.api_version ?? apiVersion} /></div>
          <div className="col-12 col-lg-6"><label className="form-label" htmlFor="facebook-interval">Publication interval (minutes)</label>
            <input className="form-control" id="facebook-interval" name="intervalMinutes" type="number" min={5} max={1440} required defaultValue={settings?.interval_minutes ?? 15} /></div>
          <div className="col-12 d-flex gap-4 flex-wrap">
            <label className="form-check form-switch"><input className="form-check-input" type="checkbox" name="enabled" defaultChecked={settings?.enabled ?? false} />Enable Facebook</label>
            <label className="form-check form-switch"><input className="form-check-input" type="checkbox" name="automaticEnabled" defaultChecked={settings?.automatic_enabled ?? false} />Allow scheduled publishing</label>
          </div>
        </div>
        {state.message ? <div className={`alert mt-3 ${state.ok ? "alert-success" : "alert-danger"}`} role="status">{state.message}</div> : null}
        <button type="submit" className="btn btn-primary mt-3 d-inline-flex align-items-center gap-2" disabled={pending}>
          {pending ? <span className="spinner-border spinner-border-sm" /> : <Save size={16} />}
          {pending ? "Verifying and saving..." : "Save Facebook Settings"}
        </button>
      </form>}
  </section>;
}
