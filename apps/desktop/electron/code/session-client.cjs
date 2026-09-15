const net = require('node:net')
const path = require('node:path')
const {prepareRoot,fail} = require('./service-storage.cjs')
const {createTmux} = require('./tmux.cjs')

function open(paths) {
  return new Promise((resolve,reject) => {
    const socket = net.createConnection(paths.socket)
    socket.setEncoding('utf8')
    const pending = new Map()
    let serial = 0, buffer = '', ready = false
    const timer = setTimeout(() => {reject(new Error('SERVICE_CONNECT_TIMEOUT')); socket.destroy()},2000)
    const close = () => socket.destroy()
    socket.on('error',() => {})
    socket.on('close',() => {
      clearTimeout(timer)
      if (!ready) reject(Object.assign(new Error('SERVICE_UNAVAILABLE'),{code:'SERVICE_UNAVAILABLE'}))
      for (const item of pending.values()) {clearTimeout(item.timer); item.reject(Object.assign(new Error('SERVICE_DISCONNECTED'),{code:'SERVICE_DISCONNECTED'}))}
      pending.clear()
    })
    socket.on('connect',() => socket.write(JSON.stringify({version:1,token:paths.token})+'\n'))
    socket.on('data',chunk => {
      buffer += chunk.toString('utf8')
      if (Buffer.byteLength(buffer) > 512*1024) return close()
      let end
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,end); buffer = buffer.slice(end+1)
        let message
        try {message = JSON.parse(line)} catch {close(); return}
        if (!ready) {
          if (message.version !== 1 || !message.ready) {close(); return}
          ready = true; clearTimeout(timer)
          resolve({close,request(method,params = {}) {
            if (socket.destroyed) return Promise.reject(Object.assign(new Error('SERVICE_DISCONNECTED'),{code:'SERVICE_DISCONNECTED'}))
            const id = ++serial
            const data = JSON.stringify({id,method,params})+'\n'
            if (Buffer.byteLength(data) > 65536 || pending.size >= 16)
              return Promise.reject(Object.assign(new Error('INVALID_REQUEST'),{code:'INVALID_REQUEST'}))
            return new Promise((resolve,reject) => {
              const timer = setTimeout(() => {
                pending.delete(id)
                reject(Object.assign(new Error('SERVICE_REQUEST_TIMEOUT'),{code:'SERVICE_REQUEST_TIMEOUT'}))
                close() // outcome may be unknown; never replay writes automatically
              },10000)
              pending.set(id,{resolve,reject,timer})
              socket.write(data)
            })
          }})
        } else {
          const item = pending.get(message.id)
          if (!item) continue
          pending.delete(message.id); clearTimeout(item.timer)
          if (message.error) item.reject(Object.assign(new Error(message.error),{code:message.error}))
          else item.resolve(message.result)
        }
      }
    })
  })
}

/** Native-only entry point. Closing a client detaches, never terminates sessions. */
async function connectCodeService({root,tmuxPath,nodePath = process.execPath,env = process.env}) {
  const paths = prepareRoot(root)
  try {return await open(paths)} catch {}
  const tmux = createTmux({binary:tmuxPath,socket:paths.tmuxSocket,env:{...env,ELECTRON_RUN_AS_NODE:'1'}})
  try {
    await tmux.launch('zq-service',{file:nodePath,cwd:paths.root,
      args:[path.join(__dirname,'session-service.cjs'),paths.root,tmuxPath]})
  } catch (error) {
    // The fixed session name is tmux's atomic singleton claim. A concurrent
    // launcher may have won; never kill or steal its service session.
    if (!await tmux.inspect('zq-service')) throw error
  }
  const deadline = Date.now()+5000
  while (Date.now()<deadline) {
    try {return await open(paths)} catch {}
    await new Promise(resolve => setTimeout(resolve,50))
  }
  fail('SERVICE_START_FAILED')
}
module.exports = {connectCodeService}
