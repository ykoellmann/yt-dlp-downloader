import { useEffect, useState } from 'react'

interface Stats {
  total_jobs: number
  by_status: Record<string, number>
  total_size_bytes: number
  disk_free_bytes: number | null
  disk_total_bytes: number | null
  disk_used_bytes: number | null
}

function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function Stat({ value, label, color = 'default' }: { value: string | number; label: string; color?: 'default' | 'blue' | 'red' }) {
  const textColor = color === 'blue' ? 'text-blue-400' : color === 'red' ? 'text-red-400' : 'text-neutral-100'
  return (
    <div>
      <p className={`text-2xl font-semibold tabular-nums leading-none ${textColor}`}>{value}</p>
      <p className="text-xs text-neutral-500 mt-1">{label}</p>
    </div>
  )
}

export function StatsBar() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/stats').then(r => r.json()).then(setStats).catch(() => {})
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [])

  if (!stats) return null

  const done    = stats.by_status.done ?? 0
  const failed  = stats.by_status.failed ?? 0
  const active  = (stats.by_status.pending ?? 0) + (stats.by_status.downloading ?? 0)

  const diskPct = stats.disk_total_bytes && stats.disk_used_bytes
    ? Math.round((stats.disk_used_bytes / stats.disk_total_bytes) * 100)
    : null

  const barColor =
    diskPct == null   ? 'bg-indigo-500' :
    diskPct > 90      ? 'bg-red-500' :
    diskPct > 75      ? 'bg-amber-500' :
                        'bg-indigo-500'

  return (
    <div className="bg-neutral-900 rounded-2xl border border-neutral-800 p-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <Stat value={done}  label="Downloads" />
        <Stat value={stats.total_size_bytes > 0 ? fmtBytes(stats.total_size_bytes) : '—'} label="Gespeichert" />
        <Stat value={active || '—'} label="Aktiv" color={active > 0 ? 'blue' : 'default'} />
        <Stat value={failed || '—'} label="Fehler"  color={failed > 0 ? 'red'  : 'default'} />
      </div>

      {diskPct !== null && stats.disk_free_bytes && stats.disk_total_bytes && (
        <div className="space-y-1.5">
          <div className="flex justify-between items-baseline">
            <span className="text-xs text-neutral-400">Speicher</span>
            <span className="text-xs text-neutral-500">
              {fmtBytes(stats.disk_free_bytes)} frei · {fmtBytes(stats.disk_total_bytes)} gesamt
            </span>
          </div>
          <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${barColor}`}
              style={{ width: `${diskPct}%` }}
            />
          </div>
          <p className="text-xs text-neutral-600 text-right">{diskPct}% belegt</p>
        </div>
      )}
    </div>
  )
}
