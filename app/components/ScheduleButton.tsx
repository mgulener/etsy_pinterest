"use client";

import { useState } from "react";
import { SubmitButton } from "./SubmitButton";

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ScheduleButton({
  id,
  title,
  scheduledAt,
  action
}: {
  id: string;
  title: string;
  scheduledAt: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center p-2"
        type="button"
        title="Edit publish time"
        aria-label="Edit publish time"
        onClick={() => setOpen(true)}
      >
        <CalendarIcon />
      </button>
      {open ? (
        <>
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h2 className="modal-title fs-5">Edit Publish Time</h2>
                  <button type="button" className="btn-close" aria-label="Close" onClick={() => setOpen(false)} />
                </div>
                <form action={action}>
                  <div className="modal-body">
                    <input type="hidden" name="id" value={id} />
                    <p className="text-muted small mb-3">{title}</p>
                    <label className="form-label" htmlFor={`scheduled-at-${id}`}>Publish time</label>
                    <input
                      id={`scheduled-at-${id}`}
                      className="form-control"
                      type="datetime-local"
                      name="scheduledAt"
                      defaultValue={toDateTimeLocal(scheduledAt)}
                      required
                    />
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
                      Cancel
                    </button>
                    <SubmitButton className="btn btn-primary" pendingText="Saving...">Save</SubmitButton>
                  </div>
                </form>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show" />
        </>
      ) : null}
    </>
  );
}
