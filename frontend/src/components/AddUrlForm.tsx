import { useEffect, useState } from 'react'
import type { Format, Quality } from '../types'

interface Props {
  onJobCreated: () => void
}

const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: 'best',  label: 'Beste verfügbare' },
  { value: '2160p', label: 'Max. 4K' },
  { value: '1080p', label: 'Max. 1080p' },
  { value: '720p',  label: 'Max. 720p' },
  { value: '480p',  label: 'Max. 480p' },
  { value: '360p',  label: 'Max. 360p' },
  { value: 'audio', label: 'Nur Audio' },
]

type Phase = 'idle' | 'fetching' | 'selecting' | 'submitting'

export function AddUrlForm({ onJobCreated }: Props) {
  const [url, setUrl]                       = useState('')
  const [quality, setQuality]               = useState<Quality>('best')
  const [advancedMode, setAdvancedMode]     = useState(false)
  const [phase, setPhase]                   = useState<Phase>('idle')
  const [formats, setFormats]               = useState<Format[]>([])
  const [selectedFormatId, setSelectedFormatId] = useState('')
  const [error, setError]                   = useState<string | null>(null)

  useEffect(() => {
    setFormats([])
    setSelectedFormatId('')
    setError(null)
    if (phase === 'selecting') setPhase('idle')
  }, [url])

  useEffect(() => {
    if (!advancedMode) {
      setFormats([])
      setSelectedFormatId('')
      if (phase === 'selecting') setPhase('idle')
    }
  }, [advancedMode])

  async function handleClick() {
    if (!url.startsWith('http')) { setError('URL muss mit http beginnen'); return }
    setError(null)

    if (advancedMode && phase !== 'selecting') {
      setPhase('fetching')
      try {
        const res = await fetch(`/api/formats?url=${encodeURIComponent(url)}`)
        if (!res.ok) throw new Error(await res.text())
        setFormats(await res.json())
        setSelectedFormatId('')
        setPhase('selecting')
      } catch (err: any) {
        setError(err.message)
        setPhase('idle')
      }
      return
    }

    setPhase('submitting')
    try {
      const fmt = formats.find(f => f.format_id === selectedFormatId)
      const body: Record<string, unknown> = { url, quality }
      if (selectedFormatId && fmt) { body.format_id = selectedFormatId; body.format_has_audio = fmt.has_audio }
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      setUrl(''); setFormats([]); setSelectedFormatId(''); setPhase('idle')
      onJobCreated()
    } catch (err: any) {
      setError(err.message)
      setPhase(advancedMode ? 'selecting' : 'idle')
    }
  }

  const btnLabel =
    phase === 'fetching'   ? 'Formate laden…' :
    phase === 'submitting' ? 'Startet…' :
    advancedMode && phase !== 'selecting' ? 'Formate abrufen' :
    'Herunterladen'

  const busy = phase === 'fetching' || phase === 'submitting'

  const videoFormats = formats.filter(f => f.has_video)
  const audioFormats = formats.filter(f => !f.has_video)

  return (
    <div className="mb-6 space-y-3">
      {/* URL row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !busy && handleClick()}
          placeholder="URL einfügen…"
          className="min-w-0 flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 text-sm text-neutral-100 placeholder-neutral-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all"
        />
        <button
          type="button"
          onClick={handleClick}
          disabled={busy || !url}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors whitespace-nowrap"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {btnLabel}
            </span>
          ) : btnLabel}
        </button>
      </div>

      {/* Options row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-neutral-500">Qualität</label>
          <select
            value={quality}
            onChange={e => setQuality(e.target.value as Quality)}
            disabled={phase === 'selecting' && !!selectedFormatId}
            className="bg-neutral-800 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent disabled:opacity-40 transition-all"
          >
            {QUALITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-neutral-500">Format wählen</span>
          <button
            type="button"
            role="switch"
            aria-checked={advancedMode}
            onClick={() => setAdvancedMode(v => !v)}
            className={`relative h-5 w-9 rounded-full transition-colors ${advancedMode ? 'bg-indigo-600' : 'bg-neutral-700'}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${advancedMode ? 'left-4' : 'left-0.5'}`} />
          </button>
        </div>
      </div>

      {/* Step 2: format picker */}
      {phase === 'selecting' && (
        <div className="bg-neutral-900 border border-indigo-500/30 rounded-xl p-3 space-y-2">
          <p className="text-xs text-neutral-500">
            {formats.length > 0
              ? `${formats.length} Formate gefunden — Format wählen und Herunterladen klicken`
              : 'Keine separaten Formate — wird mit Qualitäts-Preset heruntergeladen'}
          </p>
          {formats.length > 0 && (
            <select
              value={selectedFormatId}
              onChange={e => setSelectedFormatId(e.target.value)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent"
            >
              <option value="">Auto ({QUALITY_OPTIONS.find(o => o.value === quality)?.label})</option>
              {videoFormats.length > 0 && (
                <optgroup label="Video">
                  {videoFormats.map(f => (
                    <option key={f.format_id} value={f.format_id}>
                      {f.label}{!f.has_audio ? ' + beste Audio' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {audioFormats.length > 0 && (
                <optgroup label="Nur Audio">
                  {audioFormats.map(f => <option key={f.format_id} value={f.format_id}>{f.label}</option>)}
                </optgroup>
              )}
            </select>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</p>
      )}
    </div>
  )
}
