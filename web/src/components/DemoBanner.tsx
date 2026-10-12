import { isDemo } from '../demo/flag'

export const REPO_URL = 'https://github.com/OliverDunnDev/groupmonkey'

/** Shown only in the static GitHub Pages demo, so nobody mistakes it for the real, server-backed app. */
export default function DemoBanner() {
  if (!isDemo) return null
  return (
    <div className="demo-banner" role="note">
      <strong>LIVE DEMO</strong>
      <span>Runs entirely in your browser with sample data. Changes reset when you reload.</span>
      <a href={REPO_URL} target="_blank" rel="noreferrer">Get the code</a>
    </div>
  )
}
