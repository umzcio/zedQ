const { randomUUID } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const OUTPUT_LIMIT = 256 * 1024; // UTF-16 code units; at most 512 KiB per session.

class TerminalSessions {
  #sessions = new Map();
  #spawn;

  constructor({ spawn = (...args) => require('node-pty').spawn(...args) } = {}) {
    this.#spawn = spawn;
  }

  start() {
    // GUI launches often inherit only /usr/bin:/bin. A login shell applies the
    // user's own normal shell setup; we never inspect CLI credential files.
    const executablePath = [...new Set([
      ...(process.env.PATH || '').split(':').filter((entry) => path.isAbsolute(entry)),
      '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/sbin',
      path.join(os.homedir(), '.local/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    ])].join(':');
    const terminal = this.#spawn('/bin/zsh', ['-l'], {
      name: 'xterm-256color', cols: 100, rows: 30, cwd: os.homedir(),
      env: { ...process.env, PATH: executablePath, TERM: 'xterm-256color' },
    });
    const id = randomUUID();
    const session = { terminal, output: '', listeners: new Set(), subscriptions: [] };
    this.#sessions.set(id, session);
    session.subscriptions.push(terminal.onData((data) => {
      session.output = (session.output + data).slice(-OUTPUT_LIMIT);
      for (const listener of session.listeners) {
        try { listener(data); } catch { session.listeners.delete(listener); }
      }
    }));
    session.subscriptions.push(terminal.onExit(() => this.#release(id, session)));
    return { id, pid: terminal.pid };
  }

  #get(id) {
    const session = this.#sessions.get(id);
    if (!session) throw Object.assign(new Error('Unknown terminal session'), { code: 'UNKNOWN_TERMINAL' });
    return session;
  }

  #release(id, session) {
    this.#sessions.delete(id);
    session.listeners.clear();
    for (const subscription of session.subscriptions) subscription.dispose();
    session.subscriptions.length = 0;
    session.output = '';
  }

  attach(id, listener) {
    const session = this.#get(id);
    if (typeof listener !== 'function') throw new TypeError('Terminal listener must be a function');
    session.listeners.add(listener);
    return { output: session.output, dispose: () => session.listeners.delete(listener) };
  }

  write(id, data) {
    const session = this.#get(id);
    if (typeof data !== 'string' || data.length > 64 * 1024) throw new TypeError('Terminal input must be a string of at most 64 KiB');
    session.terminal.write(data);
  }

  stop(id) {
    const session = this.#get(id);
    session.terminal.kill();
    this.#release(id, session);
  }

  closeAll() {
    for (const id of [...this.#sessions.keys()]) this.stop(id);
  }
}

function probeOllama(endpoint = 'http://127.0.0.1:11434/') {
  let target;
  try {
    const base = new URL(endpoint);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    base.pathname = base.pathname.replace(/\/$/, '') + '/api/tags';
    target = base;
  } catch { return Promise.resolve({ available: false, models: [], error: 'Invalid Ollama endpoint' }); }
  return new Promise((resolve) => {
    let settled = false, request;
    const finish = (result) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); resolve(result);
    };
    const fail = (error) => {
      finish({ available: false, models: [], error });
      request?.destroy();
    };
    const deadline = setTimeout(() => fail('Ollama request timed out'), 2500);
    try {
      request = (target.protocol === 'https:' ? https : http).request(target, { method: 'GET', agent: false }, (response) => {
        if (response.statusCode !== 200) {
          fail(`Ollama returned HTTP ${response.statusCode}`); response.destroy(); return;
        }
        const chunks = []; let bytes = 0;
        response.on('data', (chunk) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            fail('Ollama response exceeded 1 MiB'); response.destroy(); return;
          }
          chunks.push(chunk);
        });
        response.on('error', () => fail('Ollama response was interrupted'));
        response.on('aborted', () => fail('Ollama response was interrupted'));
        response.on('end', () => {
          if (settled) return;
          try {
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!payload || !Array.isArray(payload.models) || payload.models.length > 1000 ||
                !payload.models.every((model) => model && typeof model.name === 'string' && model.name.length > 0 && model.name.length <= 512)) {
              fail('Ollama returned an invalid model list'); return;
            }
            finish({ available: true, models: [...new Set(payload.models.map((model) => model.name))] });
          } catch { fail('Ollama returned invalid JSON'); }
        });
      });
      request.on('error', (error) => fail(error.code === 'ECONNREFUSED' ? 'Ollama is not running' : 'Ollama connection failed'));
      request.end();
    } catch { fail('Ollama connection failed'); }
  });
}

module.exports = { TerminalSessions, probeOllama };
