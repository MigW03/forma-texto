import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

/** The guidelines with built-in display support. Server specs may add more at runtime. */
export type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'

/** Dropdown entry served by GET /api/guidelines — one per server specs/*.md file. */
export type GuidelineMeta = { id: string; name: string; description: Record<string, string> }

/** Shown before the catalog loads, or if the API is unreachable. */
export const FALLBACK_GUIDELINES: GuidelineMeta[] = [
  {
    id: 'abnt',
    name: 'ABNT NBR 14724',
    description: {
      en: 'Brazilian academic standard',
      'pt-BR': 'Padrão acadêmico brasileiro',
      'pt-PT': 'Padrão académico brasileiro',
    },
  },
]

/** Pick the description for the active UI language, falling back to en / first. */
export function localizedDescription(desc: Record<string, string>, lang: string): string {
  return desc[lang] ?? desc[lang.split('-')[0]] ?? desc.en ?? Object.values(desc)[0] ?? ''
}

/**
 * The formatting guidelines offered across the flow. Sourced from the server's
 * spec files, so adding a new `{id}.md` adds an option with no frontend change.
 * Returns the built-in fallback until the fetch resolves / if the API is down.
 */
export function useGuidelines(): GuidelineMeta[] {
  const [guidelines, setGuidelines] = useState<GuidelineMeta[]>(FALLBACK_GUIDELINES)
  useEffect(() => {
    let active = true
    fetch(`${API_URL}/api/guidelines`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { guidelines?: GuidelineMeta[] }) => {
        if (active && data.guidelines?.length) setGuidelines(data.guidelines)
      })
      .catch(() => { /* keep FALLBACK_GUIDELINES */ })
    return () => { active = false }
  }, [])
  return guidelines
}
