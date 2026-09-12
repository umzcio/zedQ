import type { Task } from '@zq/module-api'

export function visibleTasks(tasks: Task[], project: string, scope: string): Task[] {
  return tasks.filter(task =>
    (project === 'All projects' || task.project === project) &&
    (scope === 'All tasks' || (scope === 'Active' ? task.status !== 'Done' : task.status === 'Waiting'))
  )
}
