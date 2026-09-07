"use client";

import { useId, useState } from "react";
import { verifyInstagramPostAction } from "@/app/actions/admin";

export function VerifyPostButton({ id }: { id: string }) {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function submit(formData: FormData) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await verifyInstagramPostAction(formData);
      if (result.error) setError(result.error);
      else setOpen(false);
    } catch { setError("Verification request failed. Please try again."); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => setOpen(true)}>Verify</button>
    {open ? <>
      <div className="modal show d-block" role="dialog" aria-modal="true" aria-labelledby={dialogId} onKeyDown={(event) => { if (event.key === "Escape" && !busy) setOpen(false); }}>
        <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
          <div className="modal-header"><h2 id={dialogId} className="modal-title fs-5">Verify Instagram Post</h2>
            <button type="button" className="btn-close" disabled={busy} aria-label="Close" onClick={() => setOpen(false)} /></div>
          <form action={submit}>
            <div className="modal-body">
              <input type="hidden" name="id" value={id} />
              {error ? <div className="alert alert-warning" role="alert">{error}</div> : null}
              <label htmlFor={dialogId + "-media"} className="form-label">Published media ID (optional)</label>
              <input id={dialogId + "-media"} name="mediaId" className="form-control" inputMode="numeric" pattern="[0-9]+" disabled={busy} />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-warning" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? "Checking..." : "Verify"}</button>
            </div>
          </form>
        </div></div>
      </div><div className="modal-backdrop show" />
    </> : null}
  </>;
}
