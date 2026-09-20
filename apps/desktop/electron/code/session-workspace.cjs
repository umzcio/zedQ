const {workspace}=require('./workspace.cjs')
const {fail,uuid}=require('./service-storage.cjs')
const sessionWorkspaceMethods=new Set(['listFiles','readFile','writeFile','gitStatus','gitDiff'])
function validateSessionWorkspace(method,input) {
  if(!sessionWorkspaceMethods.has(method)||!uuid(input.sessionId)||input.projectId!==undefined||input.id!==undefined||input.hostId!==undefined)fail('INVALID_REQUEST')
}
function sessionWorkspace(snapshot,method,input) {
  validateSessionWorkspace(method,input)
  const session=snapshot.sessions.find(row=>row.id===input.sessionId)
  if(!session)fail('UNKNOWN_SESSION')
  return workspace(session.cwd,method,input)
}
module.exports={sessionWorkspace,validateSessionWorkspace}
