export type CodeMode = 'chat' | 'terminal'
export type CodeState =
  | 'starting'
  | 'ready'
  | 'busy'
  | 'approval'
  | 'stopped'
  | 'switching'
  | 'recoverable'
  | 'disconnected'
  | 'error'
  | 'limited'
export interface CodeHost {
  id: string
  name: string
  kind: 'local'
  available: boolean
}
export interface CodeProject {
  id: string
  hostId: string
  name: string
  cwd: string
  icon: string
  color: string
  createdAt: number
}
export interface CodeProfile {
  id: string
  hostId: string
  name: string
  launcherFile: string
  functionName: string
  modes: CodeMode[]
  sharedHistoryConfirmed: boolean
  createdAt: number
}
export interface CodeSession {
  id: string
  projectId: string
  hostId: string
  cwd: string
  profileId: string
  nativeId: string
  nativeIdVerified: boolean
  mode: CodeMode
  state: CodeState
  revision: number
  title: string
  createdAt: number
  updatedAt: number
  archivedAt: number | null
  pid: number | null
  error: string | null
  recovery?: { targetProfileId: string; targetMode: CodeMode; code: string }
}
export interface CodeEvent {
  seq: number
  sessionId: string
  profileId: string
  at: number
  kind:
    | 'user'
    | 'assistant'
    | 'tool'
    | 'permission'
    | 'question'
    | 'error'
    | 'status'
    | 'profile'
  text: string
  requestId?: string
  toolName?: string
  input?: Record<string, unknown>
  resolved?: boolean
}
export interface CodeRuntime {
  tmux: boolean
  pty: boolean
  claude: boolean
  chat: boolean
  reason: string | null
}
export interface CodeSnapshot {
  version: 1
  seq: number
  hosts: CodeHost[]
  projects: CodeProject[]
  profiles: CodeProfile[]
  sessions: CodeSession[]
  runtime: CodeRuntime
}
export interface CodeTerminalChunk {
  sessionId: string
  data: string
  reset?: boolean
}
export type CodeProjectInput = Pick<CodeProject, 'name' | 'cwd'> &
  Partial<Pick<CodeProject, 'hostId' | 'icon' | 'color'>>
export type CodeProfileInput = Pick<
  CodeProfile,
  'name' | 'launcherFile' | 'functionName'
> &
  Partial<Pick<CodeProfile, 'hostId' | 'modes' | 'sharedHistoryConfirmed'>>
export interface CodeOperations {
  snapshot: { input: undefined; output: CodeSnapshot }
  pickDirectory: { input: undefined; output: string | null }
  createProject: { input: CodeProjectInput; output: CodeProject }
  updateProject: {
    input: { id: string; patch: Partial<CodeProjectInput> }
    output: CodeProject
  }
  deleteProject: { input: { id: string }; output: { ok: true } }
  createProfile: { input: CodeProfileInput; output: CodeProfile }
  updateProfile: {
    input: { id: string; patch: Partial<CodeProfileInput> }
    output: CodeProfile
  }
  duplicateProfile: { input: { id: string }; output: CodeProfile }
  deleteProfile: { input: { id: string }; output: { ok: true } }
  createSession: {
    input: {
      projectId: string
      profileId: string
      mode: CodeMode
      title?: string
    }
    output: CodeSession
  }
  updateSession: {
    input: { id: string; title?: string; archived?: boolean }
    output: CodeSession
  }
  stopSession: {
    input: { id: string; expectedRevision: number }
    output: CodeSession
  }
  resumeSession: {
    input: { id: string; expectedRevision: number }
    output: CodeSession
  }
  switchSession: {
    input: {
      id: string
      expectedRevision: number
      profileId: string
      mode: CodeMode
    }
    output: CodeSession
  }
  claimSession: { input: { id: string }; output: { ok: true } }
  releaseSession: { input: { id: string }; output: { ok: true } }
  events: {
    input: { id: string; after: number }
    output: { seq: number; truncated: boolean; events: CodeEvent[] }
  }
  sendMessage: { input: { id: string; text: string }; output: { ok: true } }
  respondPermission: {
    input: {
      id: string
      requestId: string
      allow: boolean
      answers?: Record<string, string>
    }
    output: { ok: true }
  }
  interruptSession: { input: { id: string }; output: { ok: true } }
  attachTerminal: {
    input: { id: string; cols: number; rows: number }
    output: { ok: true }
  }
  detachTerminal: { input: { id: string }; output: { ok: true } }
  writeTerminal: { input: { id: string; data: string }; output: { ok: true } }
  resizeTerminal: {
    input: { id: string; cols: number; rows: number }
    output: { ok: true }
  }
  revealProject: { input: { id: string }; output: { ok: true } }
  openExternal: { input: { url: string }; output: { ok: true } }
}
export type CodeMethod = keyof CodeOperations
export interface CodeBridge {
  invoke<M extends CodeMethod>(
    method: M,
    input: CodeOperations[M]['input']
  ): Promise<CodeOperations[M]['output']>
  subscribe(listener: (snapshot: CodeSnapshot) => void): () => void
  onTerminal(listener: (chunk: CodeTerminalChunk) => void): () => void
}
