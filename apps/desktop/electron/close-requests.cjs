const { randomUUID } = require('node:crypto');
class CloseRequests {
 constructor() { this.active = null; }
 begin() { if (this.active) return null; const id = randomUUID(); this.active = {id, phase:'waiting'}; return id; }
 fail(id) { if (this.active?.id !== id || this.active.phase !== 'waiting') return false; this.active.phase = 'failed'; return true; }
 cancel(id) { if (this.active?.id !== id) return false; this.active = null; return true; }
 complete(id) { if (this.active?.id !== id || this.active.phase !== 'waiting') return false; this.active = null; return true; }
 reset() { this.active = null; }
}
module.exports = { CloseRequests };
