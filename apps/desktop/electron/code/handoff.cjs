const {buildClaudeResume} = require('./claude-launch.cjs')

/** @typedef {import('./claude-launch.cjs').Session} Session */
/** @typedef {import('./claude-launch.cjs').Profile} Profile */
/** @typedef {import('./claude-launch.cjs').Mode} Mode */
/** @typedef {{profile:Profile, mode:Mode}} Target */
/** @typedef {{id:string}} Handle */
/** @typedef {{load:(id:string)=>Promise<Session>, save:(session:Session)=>Promise<void>,
 * preflight:(session:Session,target:Target)=>Promise<void>, stopSource:(session:Session)=>Promise<void>,
 * start:(session:Session,target:Target)=>Promise<Handle>, ready:(handle:Handle)=>Promise<{nativeId:string}>,
 * stopTarget:(handle:Handle)=>Promise<void>}} Ports */

const failure = code => Object.assign(new Error(code), {code})
const validText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')

/** Internal single-host coordinator, not cross-process locking. Ports must bound
 * process waits, confirm group exit, and acquire exclusive persistent-host ownership.
 * start MUST return a cleanup handle before readiness can fail. An unexpected
 * rejection cannot prove that a partial spawn left no process behind.
 * @param {Ports} ports
 */
function createHandoffCoordinator(ports) {
  const active = new Set()
  const uncertain = new Set()
  async function persist(session) {
    try { await ports.save(structuredClone(session)) }
    catch { uncertain.add(session.id); throw failure('PERSISTENCE_FAILED') }
  }

  return {
    /** @param {{sessionId:string,expectedRevision:number,target:Target}} request
     * @returns {Promise<Session>} */
    async switchController(request) {
      if (!request || !validText(request.sessionId) || !Number.isSafeInteger(request.expectedRevision)
        || request.expectedRevision < 0) throw failure('INVALID_REQUEST')
      const {sessionId,expectedRevision} = request
      if (uncertain.has(sessionId)) throw failure('RECONCILIATION_REQUIRED')
      if (active.has(sessionId)) throw failure('SWITCH_IN_PROGRESS')
      active.add(sessionId)
      try {
        const target = structuredClone(request.target)
        const session = structuredClone(await ports.load(sessionId))
        if (!session || session.id !== sessionId || !Number.isSafeInteger(session.revision)
          || session.revision < 0 || session.revision > Number.MAX_SAFE_INTEGER - 2
          || !validText(session.profileId) || !['chat','terminal'].includes(session.mode)
          || !['ready','switching','recoverable'].includes(session.state)) throw failure('INVALID_SESSION')
        if (session.state === 'switching') throw failure('RECONCILIATION_REQUIRED')
        if (session.revision !== expectedRevision) throw failure('STALE_REVISION')
        buildClaudeResume({session:{...session,model:target?.model ?? session.model},profile:target?.profile,mode:target?.mode})
        try { await ports.preflight(structuredClone(session), structuredClone(target)) }
        catch { throw failure('PREFLIGHT_FAILED') }
        const switching = {...session,state:'switching',revision:session.revision + 1}
        delete switching.recovery
        await persist(switching)
        let handle
        let phase = 'source'
        try {
          await ports.stopSource(structuredClone(session))
          phase = 'start'
          handle = await ports.start(structuredClone(session), structuredClone(target))
          if (!handle || !validText(handle.id)) throw failure('INVALID_HANDLE')
          phase = 'ready'
          const acknowledgement = await ports.ready(handle)
          if (acknowledgement?.nativeId !== session.nativeId) {
            phase = 'identity'
            throw failure('IDENTITY_MISMATCH')
          }
          phase = 'save'
          const next = {...switching,state:'ready',revision:session.revision + 2,
            profileId:target.profile.id,mode:target.mode,...(target.model !== undefined ? {model:target.model} : {})}
          await persist(next)
          return next
        } catch (error) {
          let unknown = phase === 'source' || phase === 'start'
          if (handle) {
            try { await ports.stopTarget(handle) }
            catch { unknown = true }
          }
          const code = unknown ? 'PROCESS_OWNERSHIP_UNKNOWN'
            : phase === 'save' ? 'PERSISTENCE_FAILED'
              : phase === 'identity' ? 'IDENTITY_MISMATCH' : error.code === 'PROJECT_TRUST_REQUIRED' ? error.code : 'TARGET_NOT_READY'
          const recovery = {...session,state:unknown ? 'switching' : 'recoverable',
            revision:session.revision + 2,
            recovery:{targetProfileId:target.profile.id,targetMode:target.mode,code}}
          await persist(recovery)
          // A successfully persisted recovery supersedes an ambiguous success write.
          uncertain.delete(sessionId)
          return recovery
        }
      } finally { active.delete(sessionId) }
    },
  }
}

module.exports = {createHandoffCoordinator}
