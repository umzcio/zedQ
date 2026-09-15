const path = require('node:path')
const {privateRead,atomic} = require('./code-catalog.cjs')
// A surviving group is never signalled from a recovered PID. PID reuse cannot
// authorize termination. Only the live runner that spawned it may signal it.
function groupAbsent(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {process.kill(-pid,0);return false}catch(e){return e.code==='ESRCH'}
}
function nativeExitConfirmed(root,id,allowMissing=false) {
  const file=path.join(root,id+'.ownership.json')
  let record
  try {record=privateRead(file)}catch(e){if(e.code==='ENOENT')return allowMissing;throw e}
  if(record.state==='exited')return true
  if(record.state==='running'&&groupAbsent(record.pid)){atomic(file,{...record,state:'exited'});return true}
  return false
}
module.exports={groupAbsent,nativeExitConfirmed}
