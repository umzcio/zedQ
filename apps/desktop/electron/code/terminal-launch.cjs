const path = require('node:path')
const {fail} = require('./service-storage.cjs')
function buildTerminalLaunch({profile,session,mode}) {
 if(profile.adapter!=='terminal'||mode!=='terminal'||!profile.modes.includes('terminal'))fail('MODE_UNSUPPORTED')
 if(profile.hostId!==session.hostId)fail('HOST_MISMATCH')
 if(typeof profile.launcherFile!=='string'||!path.isAbsolute(profile.launcherFile)||profile.launcherFile.includes('\0')
  ||!path.isAbsolute(session.cwd)||!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(profile.functionName))fail('INVALID_PROFILE')
 return {file:'/bin/zsh',args:['-c','source "$1" || exit $?; shift; "$@"','zq-code',profile.launcherFile,profile.functionName],cwd:session.cwd}
}
module.exports={buildTerminalLaunch}
