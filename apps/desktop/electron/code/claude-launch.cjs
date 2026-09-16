const path = require('node:path')
const { buildProfileLaunch } = require('./profile-launch.cjs')

/** @typedef {'chat'|'terminal'} Mode */
/** @typedef {{id:string, hostId:string, launcherFile:string, functionName:string, modes:Mode[]}} Profile */
/** @typedef {{id:string, hostId:string, cwd:string, nativeId:string, profileId:string, mode:Mode,
 * revision:number, state:'ready'|'switching'|'recoverable',
 * recovery?:{targetProfileId:string, targetMode:Mode, code:string}}} Session */
/** @typedef {{file:'/bin/zsh', args:string[], cwd:string}} Launch */

const text = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
const absolute = value => text(value) && path.posix.isAbsolute(value)
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fail = code => { throw Object.assign(new Error(code), {code}) }

/** Build a local-host launch description; account state remains in the selected launcher.
 * @param {{profile:Profile, session:Session, mode:Mode}} input
 * @returns {Launch}
 */
function buildClaudeResume({profile, session, mode} = {}) {
  if (!profile || !text(profile.id) || !text(profile.hostId) || !absolute(profile.launcherFile)
    || !text(profile.functionName) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(profile.functionName)
    || !Array.isArray(profile.modes) || profile.modes.some(value => !['chat','terminal'].includes(value))) fail('INVALID_PROFILE')
  if (!session || !text(session.id) || !text(session.hostId) || !absolute(session.cwd)
    || !text(session.nativeId) || !uuid.test(session.nativeId)) fail('INVALID_SESSION')
  if (profile.hostId !== session.hostId) fail('HOST_MISMATCH')
  if (!['chat','terminal'].includes(mode) || !profile.modes.includes(mode)) fail('MODE_UNSUPPORTED')
  if (session.model !== undefined && !validModel(session.model)) fail('INVALID_MODEL')
  const args = ['--resume', session.nativeId]
  if (session.model && session.model !== 'default') args.push('--model', session.model)
  if (mode === 'chat') args.push('-p','--input-format','stream-json','--output-format','stream-json',
    '--verbose','--include-partial-messages')
  // Values are positional arguments, never executable shell source. The trusted
  // launcher may configure its own environment; no global environment is changed.
  return buildProfileLaunch(profile, session.cwd, args)
}

const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,199}$/.test(value)
module.exports = {buildClaudeResume, validModel}
