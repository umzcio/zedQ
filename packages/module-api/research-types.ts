import type { Result } from './desktop'
import type { ModelChoice } from './chat-types'
import type { ArtifactTarget } from './artifact-types'

/** Native jobs are independent of the mounted Chat view. No credentials cross this API. */
export type ResearchPhase = 'planning' | 'researching' | 'checking' | 'writing'
export type ResearchStatus = 'awaiting_plan' | 'queued' | 'running' | 'completed' | 'stopped' | 'interrupted' | 'failed'
export type ResearchSourceSelection = {
 kind: 'web' | 'attachment' | 'note' | 'project_file' | 'connector'
 id: string
 scope: string[]
}
export type ResearchSource = ResearchSourceSelection & {
 label: string
 revision: string
 capability: 'read' | 'search_read'
 scopeDescription: string
}
export type ResearchInput = {
 previousReport?: import('./artifact-types').ArtifactTarget;
 /** Caller-generated UUID makes repeated submission idempotent. */
 id: string
 conversationId: string
 projectId: string | null
 choice: ModelChoice
 brief: string
 sources: ResearchSourceSelection[]
}
export type ResearchPlan = { title: string; steps: string[]; questions: string[] }
export type ResearchEvidence = {
 id: string; sourceId: string; title: string; locator: string; url?: string
 retrievedAt: number; excerpt: string; contentHash?: string
 level: 'snippet' | 'excerpt' | 'document'
 provenance: { tool: string; requestId: string }
}
export type ResearchFinding = {
 id: string; text: string; evidenceIds: string[]
 kind: 'sourced' | 'quotation' | 'calculation' | 'interpretation'
}
export type ResearchError = { code: string; message: string }
export type ResearchUsage = { steps: number; activeMs: number; inputTokens: number; outputTokens: number; unmeasuredSteps: number }
export type ResearchLimits = { maxSteps: number; maxActiveMs: number; stepTimeoutMs: number }
export type ResearchStep = {
 id: string; phase: ResearchPhase | 'publishing'; status: 'started' | 'complete' | 'interrupted'
 startedAt: number; finishedAt: number | null; reservedMs: number
 activity?: { kind: 'web_search' | 'read' | 'connector'; sourceId: string; description: string }
}
export type ResearchSummary = {
 id: string; conversationId: string; projectId: string | null; title: string
 revision: number; phase: ResearchPhase; status: ResearchStatus
 choice: ModelChoice; createdAt: number; updatedAt: number
 evidenceCount: number; findingCount: number; usedSourceIds: string[]
 usage: ResearchUsage; limits: ResearchLimits; error: ResearchError | null
 report: ArtifactTarget | null; finishRequested: boolean
}
export type ResearchDetail = ResearchSummary & {
 brief: string; sources: ResearchSource[]; plan: ResearchPlan | null
 planVersion: number; acceptedPlanVersion: number | null
 steps: ResearchStep[]; evidence: ResearchEvidence[]; findings: ResearchFinding[]; gaps: string[]
}
export type ResearchAvailability = { available: boolean; reason: string; sources: ResearchSource[] }
export type ResearchChange = { job: ResearchSummary | null; error: ResearchError | null }
export type ResearchDraft = { previousReport?:import('./artifact-types').ArtifactTarget; mode: boolean; sources: ResearchSourceSelection[] }
export type ResearchCatalogItem = ResearchSourceSelection & { label: string; available: boolean; reason: string; scopeKind: 'none'|'domains'|'papers'|'threads'|'files'|'calendars'; scopeDescription: string }
export type ResearchCatalog = { enabled: boolean; supported: boolean; reason: string; sources: ResearchCatalogItem[] }
export type ResearchCatalogRequest = { conversationId?: string; projectId?: string|null; choice?: ModelChoice; attachmentIds?: string[] }
export type ResearchBridge = {
 catalog: (input: ResearchCatalogRequest) => Promise<Result<ResearchCatalog>>
 availability: (input: ResearchInput) => Promise<Result<ResearchAvailability>>
 create: (input: ResearchInput) => Promise<Result<ResearchDetail>>
 list: () => Promise<Result<ResearchSummary[]>>
 get: (id: string) => Promise<Result<ResearchDetail>>
 acceptPlan: (input: { id: string; expectedRevision: number; plan: ResearchPlan }) => Promise<Result<ResearchDetail>>
 stop: (id: string) => Promise<Result<ResearchDetail>>
 finish: (id: string) => Promise<Result<ResearchDetail>>
 resume: (id: string) => Promise<Result<ResearchDetail>>
 retryStorage: () => Promise<Result<ResearchSummary[]>>
 subscribe: (callback: (change: ResearchChange) => void) => () => void
}
