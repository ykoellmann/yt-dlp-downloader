import type { Job } from '../types'

const cfg: Record<Job['status'], { pill: string; dot: string; label: string }> = {
  pending:     { pill: 'bg-neutral-800 text-neutral-400 border border-neutral-700',       dot: 'bg-neutral-500',          label: 'Wartend'     },
  downloading: { pill: 'bg-blue-500/10 text-blue-400 border border-blue-500/25',          dot: 'bg-blue-400 animate-pulse', label: 'Lädt…'     },
  done:        { pill: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25', dot: 'bg-emerald-400',          label: 'Fertig'      },
  failed:      { pill: 'bg-red-500/10 text-red-400 border border-red-500/25',             dot: 'bg-red-400',              label: 'Fehler'      },
  cancelled:   { pill: 'bg-neutral-800 text-neutral-500 border border-neutral-700',       dot: 'bg-neutral-600',          label: 'Abgebrochen' },
}

export function StatusBadge({ status }: { status: Job['status'] }) {
  const { pill, dot, label } = cfg[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
      {label}
    </span>
  )
}
