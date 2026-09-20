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
  kind: 'local' | 'ssh'
  sshAlias?: string
  runAs?: 'login' | 'root'
  visible?: boolean
  error?: string | null
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
  adapter?: 'claude' | 'codex' | 'terminal'
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
  model?: string
  resolvedModel?: string
  nativeIdVerified: boolean
  ownership?: 'owned' | 'external'
  adapter?: 'claude' | 'codex' | 'terminal' | 'kimi'
  purpose?: 'profile-setup'
  tmuxTarget?: string
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
  eventId?: string
  sessionId: string
  profileId: string
  at: number
  kind:
    | 'user'
    | 'assistant'
    | 'thinking'
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
  attachmentId?: string
  data: string
  reset?: boolean
  exited?: boolean
  exitCode?: number
}
export type CodeProjectInput = Pick<CodeProject, 'name' | 'cwd'> &
  Partial<Pick<CodeProject, 'hostId' | 'icon' | 'color'>>
export type CodeProfileInput = Pick<
  CodeProfile,
  'name' | 'launcherFile' | 'functionName'
> &
  Partial<Pick<CodeProfile, 'hostId' | 'modes' | 'sharedHistoryConfirmed' | 'adapter'>>
export interface CodeFileEntry { path: string; name: string; kind: 'file' | 'directory' | 'symlink'; size: number }
export interface CodeFile { path: string; text: string; fingerprint: string }
export interface CodeChange { path: string; previousPath?: string; index: string; worktree: string; untracked: boolean }
export interface CodeCommit { hash: string; shortHash: string; author: string; date: string; subject: string }
export interface CodeRepository {
  isRepository: boolean
  root?: string; branch?: string | null; head?: string | null; upstream?: string | null
  ahead?: number | null; behind?: number | null
  remotes?: { name: string; url: string | null }[]
  changes?: CodeChange[]; changesTruncated?: boolean
  commits?: CodeCommit[]; hasMore?: boolean; lastFetch?: number | null
}
export interface CodePreview { id: string; projectId: string; sourceUrl: string; url: string; forwarded: boolean; state: 'ready' | 'stopped'; error?: string }
export interface CodeExternalTerminal { target: string; name: string; attached: boolean; ownership: 'external'; identity?: string; windows?: number; cwd?: string }
export type CodeHostInput = { name: string; sshAlias: string; runAs?: 'login' | 'root'; visible?: boolean }
export type CodeWorkspaceTarget = {projectId: string; sessionId?: never} | {sessionId: string; projectId?: never}
export interface CodeFileTransfer {id:string;name:string;direction:'upload'|'download';bytes:number;total:number;state:'running'|'done'|'skipped'|'failed';error?:string}
export interface CodeNativeSession { nativeId: string; title: string; cwd: string; updatedAt: number }
export type CodeAgent = 'claude' | 'codex' | 'kimi'
export interface CodeConversation extends CodeNativeSession {
  key: string; agent: CodeAgent; hostId: string; sessionId?: string;
  modes: CodeMode[]; profileIds: string[];
}
export interface CodeOperations {
  listNativeSessions: {input: {agent?:CodeAgent} | undefined; output: {sessions: CodeConversation[]; errors: {source:string;code:string}[]; truncated:boolean}}
  openNativeSession: {input: {agent:CodeAgent; nativeId?:string; cwd?:string; profileId?:string; mode?:CodeMode}; output:CodeSession}

  listKimiSessions: {input: undefined; output: {sessions: CodeNativeSession[]; truncated: boolean}}
  openKimiSession: {input: {nativeId: string}; output: CodeSession}
  createKimiSession: {input: {cwd: string}; output: CodeSession}
  uploadFiles: {input: CodeWorkspaceTarget & {path?:string}; output:{completed:number;canceled:boolean}}
  downloadFile: {input: CodeWorkspaceTarget & {path:string}; output:{completed:number;canceled:boolean}}
  fileTransfers: {input: CodeWorkspaceTarget; output:CodeFileTransfer[]}
  createHost: { input: CodeHostInput; output: CodeHost }
  updateHost: { input: { id: string; patch: Partial<CodeHostInput> }; output: CodeHost }
  deleteHost: { input: { id: string }; output: { ok: true } }
  discoverHosts: { input: undefined; output: { aliases: string[] } }
  connectHost: { input: { id: string }; output: CodeHost }
  disconnectHost: { input: { id: string }; output: { ok: true } }
  listFiles: { input: CodeWorkspaceTarget & { path?: string }; output: { entries: CodeFileEntry[]; truncated: boolean } }
  readFile: { input: CodeWorkspaceTarget & { path: string }; output: CodeFile }
  writeFile: { input: CodeWorkspaceTarget & { path: string; text: string; fingerprint: string }; output: CodeFile }
  gitRepository: { input: { projectId: string; skip?: number }; output: CodeRepository }
  gitCommit: { input: { projectId: string; hash: string }; output: { diff: string; truncated: boolean } }
  gitFetch: { input: { projectId: string; remote: string }; output: { ok: true } }
  gitStatus: { input: CodeWorkspaceTarget; output: { changes: CodeChange[]; truncated: boolean } }
  gitDiff: { input: CodeWorkspaceTarget & { path: string; staged?: boolean }; output: { diff: string; truncated: boolean } }
  revealFile: { input: { projectId: string; path: string }; output: { ok: true } }
  discoverTerminals: { input: { hostId: string }; output: CodeExternalTerminal[] }
  createTerminal: { input: { hostId: string; name: string; projectId?: string }; output: CodeSession }
  linkTerminal: { input: { id: string; projectId: string | null }; output: CodeSession }
  attachExternalTerminal: { input: { hostId?: string; projectId?: string; target: string; title?: string; identity?: string }; output: CodeSession }
  openPreview: { input: { projectId: string; url: string }; output: CodePreview }
  stopPreview: { input: { id: string }; output: { ok: true } }
  listPreviews: { input: undefined; output: CodePreview[] }
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
  createSetupSession: {
    input: { projectId: string; profileId: string; title?: string }
    output: CodeSession
  }
  createSession: {
    input: {
      projectId: string
      profileId: string
      mode: CodeMode
      model?: string
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
      model?: string
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
    input: { id: string; cols: number; rows: number; attachmentId?: string }
    output: { ok: true; attachmentId: string }
  }
  detachTerminal: { input: { id: string; attachmentId?: string }; output: { ok: true } }
  writeTerminal: { input: { id: string; data: string; attachmentId?: string }; output: { ok: true } }
  resizeTerminal: {
    input: { id: string; cols: number; rows: number; attachmentId?: string }
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
