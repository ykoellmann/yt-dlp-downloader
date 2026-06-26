import { useEffect, useRef, useState } from 'react'
import { AddUrlForm } from './components/AddUrlForm'
import { QueueItem } from './components/QueueItem'
import { StatsBar } from './components/StatsBar'
import type { Job } from './types'

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs')
      if (res.ok) setJobs(await res.json())
    } catch {}
  }

  useEffect(() => { fetchJobs() }, [])

  useEffect(() => {
    const active = jobs.some(j => j.status === 'pending' || j.status === 'downloading')
    if (active && !intervalRef.current) {
      intervalRef.current = setInterval(fetchJobs, 2000)
    } else if (!active && intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null } }
  }, [jobs])

  const active    = jobs.filter(j => j.status === 'pending' || j.status === 'downloading')
  const done      = jobs.filter(j => j.status === 'done')
  const failed    = jobs.filter(j => j.status === 'failed')
  const cancelled = jobs.filter(j => j.status === 'cancelled')

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="max-w-2xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-neutral-100">ytdl</h1>
            <p className="text-xs text-neutral-600 mt-0.5">Download-Service</p>
          </div>
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/50" title="Online" />
        </div>

        <StatsBar />
        <AddUrlForm onJobCreated={fetchJobs} />

        {/* Job list */}
        <div className="space-y-3">
          {/* Active */}
          {active.length > 0 && (
            <Section label="Aktiv">
              {active.map(job => <QueueItem key={job.id} job={job} onRefresh={fetchJobs} />)}
            </Section>
          )}

          {/* Cancelled */}
          {cancelled.length > 0 && (
            <Section label="Abgebrochen">
              {cancelled.map(job => <QueueItem key={job.id} job={job} onRefresh={fetchJobs} />)}
            </Section>
          )}

          {/* Failed */}
          {failed.length > 0 && (
            <Section label="Fehlgeschlagen">
              {failed.map(job => <QueueItem key={job.id} job={job} onRefresh={fetchJobs} />)}
            </Section>
          )}

          {/* Done */}
          {done.length > 0 && (
            <Section label="Fertig">
              {done.map(job => <QueueItem key={job.id} job={job} onRefresh={fetchJobs} />)}
            </Section>
          )}

          {jobs.length === 0 && (
            <div className="text-center py-16">
              <p className="text-neutral-700 text-sm">Keine Downloads</p>
              <p className="text-neutral-800 text-xs mt-1">URL einfügen und herunterladen</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2 px-1">{label}</p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
