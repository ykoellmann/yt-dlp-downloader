export interface Job {
  id: number
  url: string
  command: string
  status: 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled'
  title: string | null
  filename: string | null
  thumbnail_path: string | null
  error_message: string | null
  filesize: number | null
  duration: number | null
  download_seconds: number | null
  progress_percent: number | null
  progress_speed: string | null
  progress_eta: string | null
  created_at: string
  updated_at: string
}

export interface Format {
  format_id: string
  label: string
  ext: string
  height: number | null
  filesize: number | null
  has_video: boolean
  has_audio: boolean
  tbr: number | null
}

export type Quality = 'best' | '2160p' | '1080p' | '720p' | '480p' | '360p' | 'audio'
