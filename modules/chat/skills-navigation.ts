import { useEffect, useState } from 'react'
type SkillsPage = 'library' | 'browse'
let requestedPage: SkillsPage = 'library'
const listeners = new Set<(page: SkillsPage) => void>()
export function requestSkillSettingsPage(page: SkillsPage) { requestedPage = page; for (const listener of listeners) listener(page) }
export function useSkillSettingsBrowser() {
 const [browsing, setBrowsing] = useState(requestedPage === 'browse')
 useEffect(() => { const listener = (page: SkillsPage) => setBrowsing(page === 'browse'); listeners.add(listener); return () => { listeners.delete(listener) } }, [])
 return [browsing, (value: boolean) => { requestedPage = value ? 'browse' : 'library'; setBrowsing(value) }] as const
}
