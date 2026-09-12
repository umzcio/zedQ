const { test } = require('node:test');
const assert = require('node:assert/strict');
const { visibleTasks } = require('../../../modules/tasks/task-visibility.ts');

function task(id, status = 'Inbox', project = 'llm-img') {
  return { id, title: `Task ${id}`, description: '', project, status, priority: 'Normal' };
}

test('two newly created Inbox tasks remain visible in their project Active view', () => {
  const tasks = [task('first'), task('second')];
  assert.deepEqual(visibleTasks(tasks, 'llm-img', 'Active').map(t => t.id), ['first', 'second']);
});

test('Active includes every unfinished stage and excludes completed tasks and other projects', () => {
  const tasks = [task('inbox'), task('next', 'Next'), task('doing', 'Doing'), task('waiting', 'Waiting'), task('done', 'Done'), task('other', 'Inbox', 'Other')];
  assert.deepEqual(visibleTasks(tasks, 'llm-img', 'Active').map(t => t.id), ['inbox', 'next', 'doing', 'waiting']);
  assert.deepEqual(visibleTasks(tasks, 'All projects', 'Active').map(t => t.id), ['inbox', 'next', 'doing', 'waiting', 'other']);
});

test('Waiting stays specific and All tasks retains completed tasks', () => {
  const tasks = [task('inbox'), task('waiting', 'Waiting'), task('done', 'Done'), task('other', 'Waiting', 'Other')];
  assert.deepEqual(visibleTasks(tasks, 'llm-img', 'Waiting').map(t => t.id), ['waiting']);
  assert.deepEqual(visibleTasks(tasks, 'All projects', 'Waiting').map(t => t.id), ['waiting', 'other']);
  assert.deepEqual(visibleTasks(tasks, 'llm-img', 'All tasks').map(t => t.id), ['inbox', 'waiting', 'done']);
  assert.equal(visibleTasks(tasks, 'All projects', 'All tasks').length, 4);
  assert.deepEqual(visibleTasks(tasks, 'missing', 'Active'), []);
});
