const fs = require('node:fs')
const path = require('node:path')
const {randomBytes,randomUUID} = require('node:crypto')
const fail = code => {throw Object.assign(new Error(code),{code})}
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0')
function secure(stat,dir = false) {
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) || (dir ? !stat.isDirectory() : !stat.isFile())
    || (!dir && stat.nlink !== 1)) fail('UNSAFE_SERVICE_PATH')
}
function readPrivate(file,limit) {
  secure(fs.lstatSync(file))
  const fd = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    secure(stat)
    if (stat.size > limit) fail('INVALID_CATALOG')
    return fs.readFileSync(fd,'utf8')
  } finally {fs.closeSync(fd)}
}
function prepareRoot(root) {
  if (!text(root) || !path.isAbsolute(root)) fail('UNSAFE_SERVICE_PATH')
  fs.mkdirSync(root,{recursive:true,mode:0o700})
  secure(fs.lstatSync(root),true)
  root = fs.realpathSync(root)
  const socket = path.join(root,'ipc')
  if (Buffer.byteLength(socket) > 100) fail('SERVICE_PATH_TOO_LONG')
  const tokenPath = path.join(root,'token')
  try {fs.writeFileSync(tokenPath,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600})}
  catch (error) {if (error.code !== 'EEXIST') throw error}
  const token = readPrivate(tokenPath,64)
  if (!/^[a-f0-9]{64}$/.test(token)) fail('INVALID_SERVICE_TOKEN')
  return {root,socket,tmuxSocket:path.join(root,'tmux'),token}
}
const states = ['starting','running','stopping','stopped']
function validateCatalog(value) {
  if (!value || value.version !== 1 || !Number.isSafeInteger(value.seq) || value.seq < 0
    || !Array.isArray(value.sessions) || value.sessions.length > 32 || !Array.isArray(value.events)
    || value.events.length > 256) fail('INVALID_CATALOG')
  const ids = new Set()
  for (const row of value.sessions) {
    if (!row || !uuid(row.id) || ids.has(row.id) || !text(row.cwd) || !path.isAbsolute(row.cwd)
      || !states.includes(row.state) || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0
      || !(row.pid === null || Number.isSafeInteger(row.pid) && row.pid > 0)
      || Object.keys(row).some(key => !['id','cwd','state','createdAt','pid'].includes(key))) fail('INVALID_CATALOG')
    ids.add(row.id)
  }
  let previous = value.events.length ? value.events[0].seq - 1 : value.seq
  for (const event of value.events) {
    if (!event || !Number.isSafeInteger(event.seq) || event.seq !== previous + 1 || event.seq > value.seq
      || !ids.has(event.id) || !states.includes(event.state) || !Number.isSafeInteger(event.at)
      || Object.keys(event).some(key => !['id','state','seq','at'].includes(key))) fail('INVALID_CATALOG')
    previous = event.seq
  }
  if (previous !== value.seq || Object.keys(value).some(key => !['version','seq','sessions','events'].includes(key))) fail('INVALID_CATALOG')
  return value
}
function readCatalog(paths) {
  let raw
  try {raw = readPrivate(path.join(paths.root,'catalog.json'),1024*1024)}
  catch (error) {if (error.code === 'ENOENT') return {version:1,seq:0,sessions:[],events:[]}; throw error}
  let value
  try {value = JSON.parse(raw)} catch {fail('INVALID_CATALOG')}
  return validateCatalog(value)
}
function writeCatalog(paths,value) {
  validateCatalog(value)
  const data = JSON.stringify(value)
  if (Buffer.byteLength(data) > 1024*1024) fail('INVALID_CATALOG')
  const target = path.join(paths.root,'catalog.json')
  try {secure(fs.lstatSync(target))} catch (error) {if (error.code !== 'ENOENT') throw error}
  const temporary = path.join(paths.root,`${randomUUID()}.tmp`)
  let fd
  try {
    fd = fs.openSync(temporary,'wx',0o600)
    fs.writeFileSync(fd,data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined
    fs.renameSync(temporary,target)
    const parent = fs.openSync(paths.root,'r')
    try {fs.fsyncSync(parent)} finally {fs.closeSync(parent)}
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    try {fs.unlinkSync(temporary)} catch (error) {if (error.code !== 'ENOENT') throw error}
  }
}
module.exports = {prepareRoot,readCatalog,writeCatalog,uuid,text,fail}
