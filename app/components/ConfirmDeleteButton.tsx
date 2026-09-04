"use client";

import { useState } from "react";
import { SubmitButton } from "./SubmitButton";

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m19 6-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function ConfirmDeleteButton({
  id,
  title,
  action
}: {
  id: string;
  title: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-outline-danger btn-sm d-inline-flex align-items-center justify-content-center p-2"
        type="button"
        title="Delete from queue"
        aria-label="Delete from queue"
        onClick={() => setOpen(true)}
      >
        <TrashIcon />
      </button>
      {open ? (
        <>
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h2 className="modal-title fs-5">Delete queue item?</h2>
                  <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  />
                </div>
                <div className="modal-body">
                  <p className="mb-0">This will remove &quot;{title}&quot; from the queue.</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <form action={action}>
                    <input type="hidden" name="id" value={id} />
                    <SubmitButton className="btn btn-danger" pendingText="Deleting...">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      ) : null}
    </>
  );
}
