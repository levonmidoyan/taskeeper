import { z } from 'zod';
import { DUE_PRESETS, PRIORITIES, TASK_STATES } from '@/lib/task-filter';
import { createSchema, updateSchema } from '@/server/tasks/service';
import { decodeCursor } from '../cursor';
import { slugParam, taskPageShape, taskShape } from './shapes';
import { defineEndpoint } from './types';

const csvOf = (values: readonly string[]) =>
  new RegExp(`^!?(${values.join('|')})(,(${values.join('|')}))*$`);
const ids = z.string().max(2000).regex(/^!?[^,!]+(,[^,!]+)*$/, 'Comma-separated ids, optionally prefixed with !.');

const SORTS = ['due', 'created', 'updated', 'priority', 'title'] as const;

export const taskListQuery = z
  .object({
    projectId: z.string().min(1).optional().describe('Only this project’s tasks.'),
    state: z.enum(TASK_STATES).optional().describe('open (default), done or all.'),
    status: ids.optional().describe('Status ids; ! prefix excludes. Needs projectId.'),
    priority: z.string().regex(csvOf(PRIORITIES), `Comma-separated, from: ${PRIORITIES.join(', ')}.`).optional()
      .describe('Priorities; ! prefix excludes.'),
    assignee: ids.optional().describe('User ids, me or none; ! prefix excludes.'),
    labels: ids.optional().describe('Tasks with any of these label ids; ! prefix: with none of them.'),
    created: ids.optional().describe('Creator user ids or me; ! prefix excludes.'),
    due: z.enum(DUE_PRESETS).optional().describe('Due-date preset, in your timezone.'),
    q: z.string().trim().max(200).optional().describe('Words in the title or description.'),
    sort: z.enum([...SORTS, ...SORTS.map((s) => `-${s}` as const)]).optional()
      .describe('due (default), created, updated, priority or title; - prefix for descending.'),
    limit: z.coerce.number().int().min(1).max(100).default(50).describe('1–100, default 50.'),
    cursor: z
      .string()
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return 0;
        const offset = decodeCursor(value);
        if (offset === null) {
          ctx.addIssue({ code: 'custom', message: 'Not a cursor from this API.' });
          return z.NEVER;
        }
        return offset;
      })
      .describe('nextCursor from the previous page.'),
  })
  .refine((q) => !q.status || q.projectId, {
    message: 'status needs projectId: statuses belong to one project.',
    path: ['status'],
  });

export type TaskListQuery = z.output<typeof taskListQuery>;

export const taskParams = z.object({ slug: slugParam, taskId: z.string().min(1) });

const updateBody = updateSchema
  .omit({ taskId: true })
  .extend({ labelIds: z.array(z.string()).max(20).optional().describe('Replaces the task’s labels.') })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field to change.');

export const listTasksEndpoint = defineEndpoint({
  operationId: 'listTasks',
  method: 'GET',
  path: '/workspaces/{slug}/tasks',
  group: 'Tasks',
  summary: 'List tasks',
  description:
    'Tasks in active projects, subtasks included. Filters combine with AND; values inside one filter with OR. '
    + 'Pages are offset-based: a task created or changed between two requests can be skipped or repeated.',
  workspace: true,
  params: z.object({ slug: slugParam }),
  query: taskListQuery,
  status: 200,
  response: taskPageShape,
  errors: [],
  example: { query: { assignee: 'me', due: 'this_week', sort: 'due' } },
});

export const createTaskEndpoint = defineEndpoint({
  operationId: 'createTask',
  method: 'POST',
  path: '/workspaces/{slug}/tasks',
  group: 'Tasks',
  summary: 'Create a task',
  description: 'Lands in the project’s first column unless statusId says otherwise. Set parentTaskId for a subtask of a task in the same project.',
  workspace: true,
  params: z.object({ slug: slugParam }),
  body: createSchema,
  status: 201,
  response: taskShape,
  errors: ['unprocessable'],
  example: { body: { projectId: 'PROJECT_ID', title: 'Ship the release notes', priority: 'high', dueDate: '2026-11-01' } },
});

export const getTaskEndpoint = defineEndpoint({
  operationId: 'getTask',
  method: 'GET',
  path: '/workspaces/{slug}/tasks/{taskId}',
  group: 'Tasks',
  summary: 'Get a task',
  description: 'One task with its description. Tasks of archived projects are not found.',
  workspace: true,
  params: taskParams,
  status: 200,
  response: taskShape,
  errors: [],
});

export const updateTaskEndpoint = defineEndpoint({
  operationId: 'updateTask',
  method: 'PATCH',
  path: '/workspaces/{slug}/tasks/{taskId}',
  group: 'Tasks',
  summary: 'Update a task',
  description:
    'Send only the fields to change. statusId must be a status of the task’s own project; moving to a done status completes the task. '
    + 'assigneeId and dueDate accept null to clear.',
  workspace: true,
  params: taskParams,
  body: updateBody,
  status: 200,
  response: taskShape,
  errors: ['unprocessable'],
  example: { body: { statusId: 'DONE_STATUS_ID' } },
});

export const deleteTaskEndpoint = defineEndpoint({
  operationId: 'deleteTask',
  method: 'DELETE',
  path: '/workspaces/{slug}/tasks/{taskId}',
  group: 'Tasks',
  summary: 'Delete a task',
  description: 'Deletes the task, its subtasks, comments and attachments. Cannot be undone.',
  workspace: true,
  params: taskParams,
  status: 204,
  errors: [],
});
