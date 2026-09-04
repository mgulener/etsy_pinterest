"use client";

import { useEffect, useMemo, useState } from "react";
import type { SyncJobRow } from "@/lib/supabase/types";

type SyncJobProgressProps = {
  initialJob: SyncJobRow | null;
  initialDismissedJobIds?: string[];
  title?: string;
  latestPath?: string;
  runPath?: string;
  storageKey?: string;
};

const activeStatuses = new Set(["queued", "running"]);
const COMPLETED_JOB_VISIBLE_MS = 60 * 60_000;

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Istanbul"
    }).format(new Date(value))
    : "-";
}

function resultSummary(job: SyncJobRow) {
  if (!job.result || typeof job.result !== "object" || Array.isArray(job.result)) {
    return null;
  }

  const result = job.result as Record<string, unknown>;
  if ("published" in result || "retried" in result || "failed" in result) {
    const selected = Number(result.selected ?? 0);
    const claimed = Number(result.claimed ?? 0);
    const published = Number(result.published ?? 0);
    const recovered = Number(result.recovered ?? 0);
    const retried = Number(result.retried ?? 0);
    const failed = Number(result.failed ?? 0);
    const dryRun = Boolean(result.dryRun ?? false);

    return `Selected ${selected}, claimed ${claimed}, published ${published}, recovered ${recovered}, retried ${retried}, failed ${failed}, dry run ${dryRun}.`;
  }

  if ("generated" in result || "selected" in result) {
    const selected = Number(result.selected ?? 0);
    const generated = Number(result.generated ?? 0);
    const failed = Number(result.failed ?? 0);

    return `Selected ${selected}, generated ${generated}, failed ${failed}.`;
  }

  const fetched = Number(result.fetched ?? 0);
  const known = Number(result.known ?? 0);
  const queued = Number(result.queued ?? 0);
  const instagramQueued = Number(result.instagramQueued ?? 0);
  const errors = Array.isArray(result.errors) ? result.errors.length : 0;

  return `Fetched ${fetched}, known ${known}, Pinterest queued ${queued}, Instagram queued ${instagramQueued}, errors ${errors}.`;
}

export function SyncJobProgress({
  initialJob,
  initialDismissedJobIds = [],
  title = "Etsy Sync",
  latestPath = "/api/jobs/etsy-sync/latest",
  runPath = "/api/jobs/etsy-sync/run",
  storageKey = "dismissedEtsySyncJobId"
}: SyncJobProgressProps) {
  const [job, setJob] = useState(initialJob);
  const [dismissedJobId, setDismissedJobId] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(storageKey)
  );
  const [renderedAtMs] = useState(() => Date.now());
  const dismissedJobIds = useMemo(
    () => new Set([...initialDismissedJobIds, ...(dismissedJobId ? [dismissedJobId] : [])]),
    [dismissedJobId, initialDismissedJobIds]
  );
  const percent = useMemo(() => {
    if (!job) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round((job.progress_current / Math.max(job.progress_total, 1)) * 100)));
  }, [job]);
  const isActive = job ? activeStatuses.has(job.status) : false;
  const completedAtMs = job?.completed_at ? new Date(job.completed_at).getTime() : null;
  const isStaleCompletedJob = Boolean(
    job && !isActive && completedAtMs && renderedAtMs - completedAtMs > COMPLETED_JOB_VISIBLE_MS
  );
  const activeJobStatus = job?.status;
  const activeJobSignature = job
    ? `${job.id}:${job.status}:${job.progress_current}:${job.progress_total}:${job.updated_at}`
    : "";

  useEffect(() => {
    if (!isActive) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let unchangedPolls = 0;
    let lastSignature = activeJobSignature;

    const schedule = (delayMs: number) => {
      timer = window.setTimeout(poll, delayMs);
    };
    const nextDelay = (changed: boolean) => {
      if (changed) {
        unchangedPolls = 0;
        return 5000;
      }

      unchangedPolls += 1;
      return Math.min(30000, 5000 * 2 ** Math.min(unchangedPolls, 3));
    };
    const kick = async () => {
      if (activeJobStatus === "queued") {
        await fetch(runPath, { method: "POST", cache: "no-store" });
      }
    };
    async function poll() {
      const response = await fetch(latestPath, { cache: "no-store" });

      if (!response.ok) {
        if (!cancelled) {
          schedule(30000);
        }
        return;
      }

      const payload = (await response.json()) as { job: SyncJobRow | null };
      const nextJob = payload.job;
      const signature = nextJob
        ? `${nextJob.id}:${nextJob.status}:${nextJob.progress_current}:${nextJob.progress_total}:${nextJob.updated_at}`
        : "";
      const changed = signature !== lastSignature;
      lastSignature = signature;

      if (cancelled) {
        return;
      }

      setJob(nextJob);

      if (nextJob && activeStatuses.has(nextJob.status)) {
        schedule(nextDelay(changed));
      }
    }

    void kick().finally(() => schedule(5000));

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [activeJobSignature, activeJobStatus, isActive, latestPath, runPath]);

  if (!job || (!isActive && (dismissedJobIds.has(job.id) || isStaleCompletedJob))) {
    return null;
  }

  const dismiss = () => {
    if (!job || isActive) {
      return;
    }

    window.localStorage.setItem(storageKey, job.id);
    setDismissedJobId(job.id);
    void fetch("/api/jobs/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: job.id })
    });
  };

  const tone = job.status === "failed" ? "danger" : job.status === "succeeded" ? "success" : "info";
  const summary = resultSummary(job);

  return (
    <section className={`sync-progress-card border-${tone}`} aria-live="polite">
      <div className="d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <p className="eyebrow mb-1">{title}</p>
          <h2 className="h5 mb-1">{job.message}</h2>
          <p className="text-muted mb-0">
            Status: {job.status} | Started: {formatDate(job.started_at ?? job.created_at)} | Finished: {formatDate(job.completed_at)}
          </p>
          {job.sync_limit ? (
            <p className="text-muted mb-0">Test limit: first {job.sync_limit} listings</p>
          ) : null}
        </div>
        <div className="d-flex align-items-center gap-2">
          <span className={`badge text-bg-${tone}`}>{percent}%</span>
          {!isActive ? (
            <button
              type="button"
              className="btn-close"
              aria-label={`Dismiss ${title} progress`}
              onClick={dismiss}
            />
          ) : null}
        </div>
      </div>
      <div className="progress mt-3" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className={`progress-bar ${isActive ? "progress-bar-striped progress-bar-animated" : ""} bg-${tone}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {job.error ? <p className="text-danger fw-semibold mt-3 mb-0">{job.error}</p> : null}
      {summary ? <p className="text-muted mt-3 mb-0">{summary}</p> : null}
    </section>
  );
}
