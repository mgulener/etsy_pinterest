"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ListPlus, Pencil, RotateCcw, Send, Trash2 } from "lucide-react";
import { facebookQueueAction } from "./actions";
import type { FacebookQueueRow } from "@/lib/facebook/types";

export function FacebookActionButton({ command, id, updatedAt, listingId, disabled = false }: {
  command: "publish" | "build" | "retry" | "add"; id?: string; updatedAt?: string; listingId?: number; disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(facebookQueueAction, { ok: false, message: "" });
  const labels = { publish: "Publish Next Post", build: "Build Facebook Queue", retry: "Retry Facebook post", add: "Add to Facebook queue" };
  const Icon = command === "publish" ? Send : command === "retry" ? RotateCcw : ListPlus;
  return <div>
    <form action={action}>
      <input type="hidden" name="command" value={command} />
      <input type="hidden" name="id" value={id ?? ""} />
      <input type="hidden" name="updatedAt" value={updatedAt ?? ""} />
      <input type="hidden" name="listingId" value={listingId ?? ""} />
      <button className={`btn ${command === "retry" ? "btn-warning" : "btn-primary"} d-inline-flex align-items-center gap-2 ${command === "add" || command === "retry" ? "btn-sm p-2" : ""}`}
        disabled={disabled || pending} title={labels[command]} aria-label={labels[command]} aria-busy={pending}>
        {pending ? <span className="spinner-border spinner-border-sm" /> : <Icon size={16} />}
        {command === "publish" || command === "build" ? (pending ? (command === "publish" ? "Publishing one post..." : "Preparing queue...") : labels[command]) : null}
      </button>
    </form>
    {state.message ? <div className={`alert mt-2 mb-0 py-2 ${state.ok ? "alert-success" : "alert-danger"}`} role="status">{state.message}</div> : null}
  </div>;
}

function istanbulInput(value: string) {
  return new Date(new Date(value).getTime() + 3 * 60 * 60_000).toISOString().slice(0, 16);
}

function QueueDialog({ item, removing, close }: { item: FacebookQueueRow; removing: boolean; close(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [message, setMessage] = useState(item.message);
  const [scheduledAt, setScheduledAt] = useState(istanbulInput(item.scheduled_at));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.set("command", removing ? "cancel" : "save");
      form.set("id", item.id); form.set("updatedAt", item.updated_at);
      form.set("message", message);
      form.set("scheduledAt", new Date(`${scheduledAt}:00+03:00`).toISOString());
      const result = await facebookQueueAction({ ok: false, message: "" }, form);
      if (result.ok) { close(); router.refresh(); }
      else setError(result.message);
    } catch { setError("The change could not be confirmed. Refresh to check its saved state."); }
    finally { setBusy(false); }
  }

  return createPortal(<dialog ref={ref} aria-labelledby={titleId}
    className="modal d-block border-0 p-0 m-0 mw-100 mh-100 bg-dark bg-opacity-50"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className={`modal-dialog ${removing ? "" : "modal-lg"} modal-dialog-centered`}>
      <form className="modal-content" onSubmit={save}>
        <div className="modal-header"><h2 className="modal-title fs-5" id={titleId}>{removing ? "Remove from Facebook queue?" : "Edit Facebook post"}</h2>
          <button type="button" className="btn-close" aria-label="Close" disabled={busy} onClick={close} /></div>
        <div className="modal-body">
          <div className="d-flex align-items-center gap-3 mb-3">
            <img src={item.image_url} alt="" className="thumb flex-shrink-0" width={85} height={85} />
            <p className="mb-0 text-break fw-semibold">{item.title}</p>
          </div>
          {!removing ? <>
            <label className="form-label" htmlFor={`${titleId}-message`}>Message</label>
            <textarea id={`${titleId}-message`} className="form-control" rows={5} required maxLength={2000} value={message}
              disabled={busy} onChange={event => setMessage(event.target.value)} />
            <div className="small text-secondary text-end mb-3">{message.length} / 2000</div>
            <a href={item.destination_url} target="_blank" rel="noreferrer" className="d-block mb-3 text-break">{item.destination_url}</a>
            <label className="form-label" htmlFor={`${titleId}-date`}>Scheduled at (UTC+3 / Istanbul)</label>
            <input id={`${titleId}-date`} className="form-control" type="datetime-local" required disabled={busy} value={scheduledAt}
              onChange={event => setScheduledAt(event.target.value)} />
          </> : <p className="mb-0">This cancels the queued post. It does not delete anything from Etsy or Facebook.</p>}
          {error ? <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div> : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-warning" disabled={busy} onClick={close}>Cancel</button>
          <button type="submit" className={`btn ${removing ? "btn-danger" : "btn-primary"}`} disabled={busy}>
            {busy ? <span className="spinner-border spinner-border-sm me-2" /> : null}
            {busy ? "Saving..." : removing ? "Remove" : "Save"}
          </button>
        </div>
      </form>
    </div>
  </dialog>, document.body);
}

export function FacebookItemActions({ item }: { item: FacebookQueueRow }) {
  const [dialog, setDialog] = useState<"edit" | "remove" | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  function close() { setDialog(null); trigger.current?.focus(); }
  if (!["pending", "failed"].includes(item.status)) return null;
  return <div className="d-flex gap-2 justify-content-end">
    <button className="btn btn-primary btn-sm p-2 d-inline-flex" aria-label="Edit Facebook post" title="Edit Facebook post"
      onClick={event => { trigger.current = event.currentTarget; setDialog("edit"); }}><Pencil size={16} /></button>
    {item.status === "failed" ? <FacebookActionButton command="retry" id={item.id} updatedAt={item.updated_at} /> : null}
    <button className="btn btn-danger btn-sm p-2 d-inline-flex" aria-label="Remove from Facebook queue" title="Remove from Facebook queue"
      onClick={event => { trigger.current = event.currentTarget; setDialog("remove"); }}><Trash2 size={16} /></button>
    {dialog ? <QueueDialog item={item} removing={dialog === "remove"} close={close} /> : null}
  </div>;
}
