import { useState } from 'react'
import { StatusBadge } from './StatusBadge'
import type { Job } from '../types'

interface Props { job: Job; onRefresh: () => void }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}
function fmtBytes(b: number) {
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`
  return `${(b / 1024 ** 3).toFixed(2)} GB`
}
function fmtDuration(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    : `${m}:${String(sec).padStart(2,'0')}`
}
function fmtDlTime(s: number) {
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n) + '…' : s }

export function QueueItem({ job, onRefresh }: Props) {
  const [command, setCommand] = useState(job.command)
  const [busy, setBusy] = useState(false)

  async function handleRetry() {
    setBusy(true)
    try {
      const endpoint = command !== job.command ? 'command' : 'retry'
      const opts = command !== job.command
        ? { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command }) }
        : { method: 'POST' }
      await fetch(`/api/jobs/${job.id}/${endpoint}`, opts)
      onRefresh()
    } finally { setBusy(false) }
  }

  async function handleDelete() {
    setBusy(true)
    try { await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' }); onRefresh() }
    finally { setBusy(false) }
  }

  async function handleCancel() {
    setBusy(true)
    try { await fetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' }); onRefresh() }
    finally { setBusy(false) }
  }

  const pct = job.progress_percent

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden transition-all">

      {/* ── Done ── */}
      {job.status === 'done' && (
        <div className="flex gap-0">
          {/* Thumbnail */}
          <div className="flex-shrink-0 w-36 sm:w-44 self-stretch">
            {job.thumbnail_path ? (
              <img
                src={`/api/jobs/${job.id}/thumbnail`}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full min-h-[80px] bg-neutral-800 flex items-center justify-center">
                <span className="text-neutral-600 text-xs">Kein Bild</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 p-4 flex flex-col justify-between">
            <div className="min-w-0">
              <div className="flex items-start justify-between gap-2 mb-1">
                <StatusBadge status="done" />
                <span className="text-xs text-neutral-600 whitespace-nowrap">{fmtDate(job.created_at)}</span>
              </div>
              <p className="text-neutral-100 font-semibold text-sm leading-snug mt-2 line-clamp-2">{job.title ?? 'Unbekannt'}</p>
              {job.filename && (
                <p className="text-neutral-600 font-mono text-xs truncate mt-1">{job.filename}</p>
              )}
            </div>
            <div className="flex items-center justify-between mt-3">
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {job.filesize        != null && <Chip>{fmtBytes(job.filesize)}</Chip>}
                {job.duration        != null && <Chip>{fmtDuration(job.duration)}</Chip>}
                {job.download_seconds != null && <Chip>in {fmtDlTime(job.download_seconds)}</Chip>}
              </div>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="text-xs text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-40 ml-2 flex-shrink-0"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pending ── */}
      {job.status === 'pending' && (
        <div className="flex items-center gap-3 px-4 py-3">
          <StatusBadge status="pending" />
          <span className="text-neutral-500 text-sm min-w-0 truncate flex-1">{trunc(job.url, 70)}</span>
          <span className="text-xs text-neutral-700 whitespace-nowrap flex-shrink-0">{fmtDate(job.created_at)}</span>
        </div>
      )}

      {/* ── Downloading ── */}
      {job.status === 'downloading' && (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <StatusBadge status="downloading" />
            <span className="text-neutral-500 text-sm min-w-0 truncate flex-1">{trunc(job.url, 60)}</span>
            <button
              onClick={handleCancel}
              disabled={busy}
              title="Download abbrechen"
              className="flex-shrink-0 text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-40 text-xs"
            >
              ✕ Stopp
            </button>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
              {pct != null ? (
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-600 to-violet-500 animate-pulse" />
              )}
            </div>
            {pct != null && (
              <div className="flex items-center justify-between text-xs">
                <div className="flex gap-3 text-neutral-400">
                  <span className="tabular-nums font-medium">{pct.toFixed(1)}%</span>
                  {job.progress_speed && <span>{job.progress_speed}</span>}
                </div>
                {job.progress_eta && job.progress_eta !== '00:00' && (
                  <span className="text-neutral-600">noch {job.progress_eta}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Cancelled ── */}
      {job.status === 'cancelled' && (
        <div className="flex items-center gap-3 px-4 py-3">
          <StatusBadge status="cancelled" />
          <span className="text-neutral-600 text-sm min-w-0 truncate flex-1">{trunc(job.url, 60)}</span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleRetry}
              disabled={busy}
              className="text-xs text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-40"
            >
              Wiederholen
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-xs text-neutral-600 hover:text-red-400 transition-colors disabled:opacity-40"
            >
              Löschen
            </button>
          </div>
        </div>
      )}

      {/* ── Failed ── */}
      {job.status === 'failed' && (
        <div className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <StatusBadge status="failed" />
            <span className="text-neutral-500 text-sm min-w-0 truncate flex-1">{trunc(job.url, 60)}</span>
            <span className="text-xs text-neutral-700 whitespace-nowrap flex-shrink-0">{fmtDate(job.created_at)}</span>
          </div>

          {job.error_message && (
            <pre className="text-red-400/80 text-xs bg-red-500/5 border border-red-500/15 rounded-xl p-3 overflow-auto max-h-28 whitespace-pre-wrap leading-relaxed">
              {job.error_message}
            </pre>
          )}

          <div className="space-y-1">
            <label className="text-xs text-neutral-600">Befehl bearbeiten</label>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              rows={2}
              className="w-full font-mono text-xs bg-neutral-800 border border-neutral-700 rounded-xl p-3 text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent resize-y transition-all"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleRetry}
              disabled={busy}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Erneut versuchen
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 text-xs font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Löschen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-neutral-500">{children}</span>
}
