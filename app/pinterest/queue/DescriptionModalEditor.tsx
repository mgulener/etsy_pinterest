"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Sparkles } from "lucide-react";
import { PIN_DESCRIPTION_MAX_LENGTH } from "@/lib/pinterest/description";

type EditorProps = {
  id: string;
  title: string;
  imageUrl: string | null;
  description: string;
  updatedAt: string;
};

function DescriptionDialog({
  id, title, imageUrl, description, updatedAt, onClose, onSaved
}: EditorProps & {
  onClose(): void;
  onSaved(description: string, updatedAt: string): void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const fieldId = useId();
  const [draft, setDraft] = useState(description);
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    textareaRef.current?.focus();
    return () => {
      requestRef.current?.abort();
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  function closeDialog() {
    dialogRef.current?.close();
    onClose();
  }

  async function submit(mode: "ai" | "save") {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(mode);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/pinterest/queue/${id}/description`, {
        method: mode === "ai" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]),
        body: JSON.stringify({ expectedUpdatedAt: updatedAt, ...(mode === "save" ? { description: draft } : {}) })
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
      if (typeof data.description !== "string" || (mode === "save" && typeof data.updatedAt !== "string")) {
        throw new Error("Unexpected response. Refresh the page to check the saved description.");
      }
      if (mode === "ai") {
        setDraft(data.description);
        setNotice("AI draft ready. Not saved.");
        textareaRef.current?.focus();
      } else {
        dialogRef.current?.close();
        onSaved(data.description, data.updatedAt);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Request failed. Please try again.");
      }
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setBusy(null);
      }
    }
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="modal d-block border-0 p-0 m-0 mw-100 mh-100 bg-dark bg-opacity-50"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); if (busy !== "save") closeDialog(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), textarea"));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
    >
      <div className="modal-dialog modal-lg modal-dialog-centered">
        <form className="modal-content" onSubmit={(event) => { event.preventDefault(); void submit("save"); }}>
          <div className="modal-header">
            <h2 className="modal-title fs-5" id={titleId}>Edit Pinterest description</h2>
            <button type="button" className="btn-close" aria-label="Close" disabled={busy === "save"} onClick={closeDialog} />
          </div>
          <div className="modal-body">
            <div className="d-flex align-items-center gap-3 mb-4">
              {imageUrl ? <img className="thumb flex-shrink-0" src={imageUrl} width={85} height={85} alt="" /> : null}
              <p className="mb-0 fw-semibold text-break">{title}</p>
            </div>
            <label className="form-label" htmlFor={fieldId}>Description</label>
            <textarea
              ref={textareaRef}
              id={fieldId}
              className="form-control"
              rows={6}
              maxLength={PIN_DESCRIPTION_MAX_LENGTH}
              required
              value={draft}
              readOnly={busy !== null}
              onChange={(event) => { setDraft(event.target.value); setNotice(null); }}
            />
            <div className="d-flex justify-content-between gap-2 mt-2 small text-secondary">
              <span role="status">{notice}</span>
              <span className="text-nowrap">{draft.length} / {PIN_DESCRIPTION_MAX_LENGTH}</span>
            </div>
            {error ? <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div> : null}
          </div>
          <div className="modal-footer gap-2">
            <button type="button" className="btn ai-button me-auto d-inline-flex align-items-center gap-2" disabled={busy !== null} onClick={() => void submit("ai")}>
              {busy === "ai" ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
              {busy === "ai" ? "Generating..." : "Update With AI"}
            </button>
            <button type="button" className="btn btn-warning" disabled={busy === "save"} onClick={closeDialog}>Cancel</button>
            <button type="submit" className="btn btn-primary d-inline-flex align-items-center gap-2" disabled={busy !== null || !draft.trim()}>
              {busy === "save" ? <span className="spinner-border spinner-border-sm" aria-hidden="true" /> : null}
              {busy === "save" ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </dialog>,
    document.body
  );
}

export function DescriptionModalEditor(props: EditorProps) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState({ description: props.description, updatedAt: props.updatedAt });

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return <>
    <button ref={triggerRef} type="button" className="btn btn-primary btn-sm d-inline-flex align-items-center justify-content-center p-2"
      title="Edit Pinterest description" aria-label="Edit Pinterest description" onClick={() => setOpen(true)}>
      <Pencil size={16} aria-hidden="true" />
    </button>
    {open ? <DescriptionDialog {...props} {...saved} onClose={close} onSaved={(description, updatedAt) => {
      setSaved({ description, updatedAt });
      close();
      router.refresh();
    }} /> : null}
  </>;
}
