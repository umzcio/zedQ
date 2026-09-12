const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CloseRequests } = require('../electron/close-requests.cjs');
test('a timed-out acknowledgement cannot complete a newer close attempt', () => {
 const close = new CloseRequests();
 const first = close.begin();
 assert.equal(close.begin(), null);
 assert.equal(close.fail(first), true);
 assert.equal(close.complete(first), false);
 assert.equal(close.cancel(first), true);
 const second = close.begin();
 assert.notEqual(first, second);
 assert.equal(close.complete(first), false);
 assert.equal(close.complete(second), true);
 assert.equal(close.complete(second), false);
});
test('unrecognized cancellation cannot unfreeze an active close', () => {
 const close = new CloseRequests(); const id = close.begin();
 assert.equal(close.cancel('stale'), false);
 assert.equal(close.begin(), null);
 assert.equal(close.complete(id), true);
 assert.ok(close.begin());
});
