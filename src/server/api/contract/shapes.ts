import { z } from 'zod';
import { PRIORITIES } from '@/lib/task-filter';

const iso = () => z.string().describe('ISO-8601 timestamp, UTC.');

export const slugParam = z.string().min(1).describe('Workspace slug, from GET /workspaces.');

export const meShape = z.object({ id: z.string(), name: z.string(), email: z.string() });

export const workspaceShape = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member']).describe('Your role; the API acts with it.'),
});

export const projectShape = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  openTaskCount: z.number().int(),
});

export const statusShape = z.object({ id: z.string(), name: z.string(), isDone: z.boolean() });

export const projectDetailShape = projectShape.extend({
  statuses: z.array(statusShape).describe('Board order, left to right.'),
});

export const labelShape = z.object({ id: z.string(), name: z.string(), color: z.string() });

export const memberShape = z.object({
  id: z.string().describe('User id; use it as assigneeId.'),
  name: z.string(),
  email: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
});

export const personRef = z.object({ id: z.string(), name: z.string() });

export const taskSummaryShape = z.object({
  id: z.string(),
  projectId: z.string(),
  parentTaskId: z.string().nullable().describe('Set on subtasks.'),
  title: z.string(),
  status: statusShape,
  priority: z.enum(PRIORITIES),
  assignee: personRef.nullable(),
  dueDate: z.string().meta({ format: 'date' }).nullable().describe('YYYY-MM-DD.'),
  labels: z.array(personRef.describe('A label: id and name.')),
  createdAt: iso(),
  updatedAt: iso(),
  url: z.string().describe('The task in the web app.'),
});

export const taskShape = taskSummaryShape.extend({ description: z.string().describe('Markdown.') });

export const taskPageShape = z.object({
  data: z.array(taskSummaryShape),
  nextCursor: z.string().nullable().describe('Pass as cursor for the next page; null on the last page.'),
});

export const commentShape = z.object({
  id: z.string(),
  author: personRef.nullable().describe('Null once the author has deleted their account.'),
  body: z.string().describe('Markdown.'),
  createdAt: iso(),
  editedAt: iso().nullable(),
});

export const listOf = <T extends z.ZodType>(item: T) => z.object({ data: z.array(item) });

export type ApiMe = z.infer<typeof meShape>;
export type ApiWorkspace = z.infer<typeof workspaceShape>;
export type ApiProject = z.infer<typeof projectShape>;
export type ApiStatus = z.infer<typeof statusShape>;
export type ApiProjectDetail = z.infer<typeof projectDetailShape>;
export type ApiLabel = z.infer<typeof labelShape>;
export type ApiMember = z.infer<typeof memberShape>;
export type ApiTaskSummary = z.infer<typeof taskSummaryShape>;
export type ApiTask = z.infer<typeof taskShape>;
export type ApiTaskPage = z.infer<typeof taskPageShape>;
export type ApiComment = z.infer<typeof commentShape>;
