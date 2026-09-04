"use client";

import { useState, useTransition } from "react";
import { updateInstagramQueueItemAction } from "@/app/actions/admin";
import type { InstagramPostMode } from "@/lib/instagram/types";

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((url): url is string => typeof url === "string")
    : [];
}

function EditIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m5.6 5.6 2.8 2.8" />
      <path d="m15.6 15.6 2.8 2.8" />
      <path d="m18.4 5.6-2.8 2.8" />
      <path d="m8.4 15.6-2.8 2.8" />
    </svg>
  );
}

function resolveInitialUrls(currentUrls: string[], selectableUrls: string[], postMode: InstagramPostMode) {
  const initialUrls = currentUrls.length > 0
    ? currentUrls.filter((url) => selectableUrls.includes(url)).slice(0, 10)
    : selectableUrls.slice(0, postMode === "carousel" ? 5 : 1);

  return initialUrls.length > 0 ? initialUrls : selectableUrls.slice(0, 1);
}

export function CaptionModalEditor({
  id,
  caption,
  postMode,
  mediaUrls,
  availableMediaUrls
}: {
  id: string;
  caption: string;
  postMode: InstagramPostMode;
  mediaUrls: unknown;
  availableMediaUrls: unknown;
}) {
  const [open, setOpen] = useState(false);
  const [draftCaption, setDraftCaption] = useState(caption);
  const [selectedMode, setSelectedMode] = useState<InstagramPostMode>(postMode);
  const [isPending, startTransition] = useTransition();
  const [isAiPending, setIsAiPending] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const availableUrls = getStringArray(availableMediaUrls);
  const currentUrls = getStringArray(mediaUrls);
  const selectableUrls = availableUrls.length > 0
    ? availableUrls.slice(0, 10)
    : currentUrls.slice(0, 10);
  const [selectedUrls, setSelectedUrls] = useState<string[]>(() => resolveInitialUrls(currentUrls, selectableUrls, postMode));

  function openEditor() {
    setDraftCaption(caption);
    setSelectedMode(postMode);
    setSelectedUrls(resolveInitialUrls(currentUrls, selectableUrls, postMode));
    setAiError(null);
    setOpen(true);
  }

  async function updateWithAi() {
    setIsAiPending(true);
    setAiError(null);

    try {
      const response = await fetch("/api/instagram/caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || typeof payload.caption !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "AI caption could not be generated.");
      }

      setDraftCaption(payload.caption);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI caption could not be generated.");
    } finally {
      setIsAiPending(false);
    }
  }

  function save(formData: FormData) {
    startTransition(async () => {
      selectedUrls.forEach((url) => formData.append("selectedMediaUrls", url));
      await updateInstagramQueueItemAction(formData);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        className="btn btn-primary btn-sm d-inline-flex align-items-center justify-content-center p-2"
        type="button"
        onClick={openEditor}
        title="Edit caption"
        aria-label="Edit caption"
      >
        <EditIcon />
      </button>
      {open ? (
        <>
          <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
            <div className="modal-dialog modal-dialog-centered modal-xl">
              <div className="modal-content">
                <div className="modal-header">
                  <div>
                    <h2 className="modal-title fs-5">Edit Instagram Caption</h2>
                    <p className="text-muted mb-0 small">Review the caption, media mode, and selected images before publishing.</p>
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
                    {aiError ? <div className="alert alert-danger py-2">{aiError}</div> : null}
                    <textarea
                      className="form-control"
                      name="caption"
                      value={draftCaption}
                      onChange={(event) => setDraftCaption(event.target.value)}
                      maxLength={2200}
                      rows={8}
                      autoFocus
                    />
                    <div className="mt-3">
                      <label className="form-label" htmlFor={`post-mode-${id}`}>Post type</label>
                      <select
                        id={`post-mode-${id}`}
                        className="form-select"
                        name="postMode"
                        value={selectedMode}
                        onChange={(event) => {
                          const nextMode = event.target.value === "carousel" ? "carousel" : "single";
                          setSelectedMode(nextMode);
                          setSelectedUrls((urls) => {
                            if (nextMode === "single") {
                              return urls.length > 0 ? urls.slice(0, 1) : selectableUrls.slice(0, 1);
                            }

                            return urls.length > 0 ? urls.slice(0, 10) : selectableUrls.slice(0, 5);
                          });
                        }}
                      >
                        <option value="single">Single</option>
                        <option value="carousel" disabled={selectableUrls.length < 2}>
                          Carousel
                        </option>
                      </select>
                    </div>
                    {selectableUrls.length > 0 ? (
                      <div className="mt-4">
                        <div className="d-flex align-items-center justify-content-between gap-3 mb-2">
                          <label className="form-label mb-0">Images</label>
                          <span className="text-muted small">
                            {selectedUrls.length} selected{selectedMode === "carousel" ? " / 10 max" : ""}
                          </span>
                        </div>
                        <div className="d-flex flex-wrap gap-2">
                          {selectableUrls.map((url, index) => {
                            const checked = selectedUrls.includes(url);

                            return (
                              <label
                                key={url}
                                className={`position-relative border rounded overflow-hidden ${checked ? "border-primary border-2" : "border-secondary-subtle"}`}
                                style={{ width: 86, height: 86, cursor: "pointer" }}
                                title={`Image ${index + 1}`}
                              >
                                <input
                                  className="form-check-input image-picker-control position-absolute top-0 start-0 m-1"
                                  type={selectedMode === "carousel" ? "checkbox" : "radio"}
                                  name="selectedMediaPicker"
                                  checked={checked}
                                  onChange={() => {
                                    setSelectedUrls((urls) => {
                                      if (selectedMode === "single") {
                                        return [url];
                                      }

                                      if (urls.includes(url)) {
                                        return urls.length > 1 ? urls.filter((item) => item !== url) : urls;
                                      }

                                      return urls.length >= 10 ? urls : [...urls, url];
                                    });
                                  }}
                                />
                                <img
                                  src={url}
                                  alt=""
                                  className="w-100 h-100 object-fit-cover"
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="modal-footer justify-content-between">
                    <button
                      type="button"
                      className="btn ai-button d-inline-flex align-items-center gap-2"
                      onClick={updateWithAi}
                      disabled={isAiPending || isPending}
                      aria-busy={isAiPending}
                    >
                      <AiIcon />
                      {isAiPending ? "Updating..." : "Update With AI"}
                    </button>
                    <div className="d-flex align-items-center gap-2">
                      <button type="button" className="btn btn-outline-secondary" onClick={() => setOpen(false)}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary" disabled={isPending || isAiPending} aria-busy={isPending}>
                        {isPending ? "Saving..." : "Save"}
                      </button>
                    </div>
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
