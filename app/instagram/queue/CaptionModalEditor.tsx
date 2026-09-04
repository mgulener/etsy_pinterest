"use client";

import { useState, useTransition } from "react";
import { updateInstagramQueueItemAction } from "@/app/actions/admin";
import type { InstagramPostMode } from "@/lib/instagram/types";

function getMediaCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function CaptionModalEditor({
  id,
  caption,
  postMode,
  mediaUrls
}: {
  id: string;
  caption: string;
  postMode: InstagramPostMode;
  mediaUrls: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save(formData: FormData) {
    startTransition(async () => {
      await updateInstagramQueueItemAction(formData);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center p-2"
        type="button"
        onClick={() => setOpen(true)}
        title="Edit caption"
        aria-label="Edit caption"
      >
        <EditIcon />
      </button>
      {open ? (
        <>
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-dialog-centered modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h2 className="modal-title fs-5">Edit Instagram Caption</h2>
                    <p className="text-muted mb-0 small">Review the caption and media mode before publishing.</p>
                  </div>
                  <button
                    type="button"
                    className="btn-close"
                    aria-label="Close"
                    onClick={() => setOpen(false)}
                  />
                </div>
                <form action={save}>
                  <div className="modal-body">
                    <input type="hidden" name="id" value={id} />
                    <textarea
                      className="form-control"
                      name="caption"
                      defaultValue={caption}
                      maxLength={2200}
                      rows={12}
                      autoFocus
                    />
                    <select className="form-select mt-3" name="postMode" defaultValue={postMode}>
                      <option value="single">Single</option>
                      <option value="carousel" disabled={getMediaCount(mediaUrls) < 2}>
                        Carousel
                      </option>
                    </select>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={isPending} aria-busy={isPending}>
                      {isPending ? "Saving..." : "Save"}
                    </button>
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
