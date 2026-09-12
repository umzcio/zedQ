const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { TerminalSessions, probeOllama } = require('./runtime.cjs');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForMarker(sessions, id, marker) {
  return new Promise((resolve, reject) => {
    let output = '', attachment;
    const timeout = setTimeout(() => {
      attachment?.dispose(); reject(new Error('PTY did not produce the expected marker within 10 seconds'));
    }, 10_000);
    const inspect = (data) => {
      output = (output + data).slice(-256 * 1024);
      if (output.includes(marker)) { clearTimeout(timeout); attachment?.dispose(); resolve(); }
    };
    try { attachment = sessions.attach(id, inspect); inspect(attachment.output); }
    catch (error) { clearTimeout(timeout); reject(error); }
  });
}

// The complete expected marker never appears in terminal input, so terminal
// echo cannot pass this proof without the shell actually executing printf.
function markerCommand(token) {
  return `printf '\\nZQ_%s:%s\\n' '${token}' "$$"\r`;
}

async function runRuntimeCheck() {
  const sessions = new TerminalSessions();
  let terminal;
  try {
    terminal = sessions.start();
    assert.ok(Number.isInteger(terminal.pid) && terminal.pid > 0, 'PTY must have a native process ID');
    const token = randomBytes(12).toString('hex');
    const firstMarker = `ZQ_${token}_first:${terminal.pid}`;
    const first = waitForMarker(sessions, terminal.id, firstMarker);
    sessions.write(terminal.id, markerCommand(`${token}_first`));
    await first;

    // No renderer/output listener remains. Poll replay snapshots without
    // keeping a live attachment, proving output survives in native ownership.
    const detachedMarker = `ZQ_${token}_detached:${terminal.pid}`;
    sessions.write(terminal.id, markerCommand(`${token}_detached`));
    let replayFound = false;
    const replayDeadline = Date.now() + 10_000;
    while (Date.now() < replayDeadline) {
      await pause(25);
      const replay = sessions.attach(terminal.id, () => {});
      replay.dispose();
      if (replay.output.includes(detachedMarker)) { replayFound = true; break; }
    }
    assert.ok(replayFound, 'Detached PTY output must be replayed with the original shell PID');

    const lastMarker = `ZQ_${token}_reattached:${terminal.pid}`;
    const last = waitForMarker(sessions, terminal.id, lastMarker);
    sessions.write(terminal.id, markerCommand(`${token}_reattached`));
    await last;
    sessions.stop(terminal.id);
    assert.throws(() => sessions.write(terminal.id, 'no'), { code: 'UNKNOWN_TERMINAL' });
    let stopped = false;
    const stopDeadline = Date.now() + 3000;
    while (Date.now() < stopDeadline) {
      try { process.kill(terminal.pid, 0); }
      catch (error) { if (error.code === 'ESRCH') { stopped = true; break; } throw error; }
      await pause(25);
    }
    assert.ok(stopped, 'Stopped terminal process must exit');

    const endpoint = process.env.ZQ_OLLAMA_URL;
    const ollama = endpoint ? await probeOllama(endpoint) : { available: false, models: [], error: 'No Ollama endpoint selected; set ZQ_OLLAMA_URL' };
    return {
      runtime: { electron: process.versions.electron || null, node: process.versions.node, abi: process.versions.modules },
      terminal: { available: true, pid: terminal.pid, markerVerified: true, detachedOutputReplayed: true, samePid: true, stopped: true },
      ollama: { endpoint: endpoint || null, ...ollama, generation: { performed: false, reason: 'This proof lists installed model metadata only; no inference or downloads.' } },
    };
  } finally { sessions.closeAll(); }
}

module.exports = { runRuntimeCheck };
