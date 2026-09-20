import {
  boolean,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
import { project } from './project';

export const priorityEnum = pgEnum('task_priority', ['none', 'low', 'medium', 'high', 'urgent']);

export const taskStatus = pgTable(
  'task_status',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('muted'),
    position: text('position').notNull(),
    isDone: boolean('is_done').notNull().default(false),
  },
  (t) => [index('task_status_project_position_idx').on(t.projectId, t.position)],
);

export const task = pgTable(
  'task',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // RESTRICT so a column holding tasks cannot be deleted. Project deletion runs
    // as an explicit transaction instead of relying on cascade ordering (spec §3.2).
    statusId: text('status_id').notNull().references(() => taskStatus.id, { onDelete: 'restrict' }),
    priority: priorityEnum('priority').notNull().default('none'),
    assigneeId: text('assignee_id').references(() => user.id, { onDelete: 'set null' }),
    // A bare date: "due the 21st" is a calendar day in the workspace zone, not an
    // instant (spec §3.4).
    dueDate: date('due_date'),
    position: text('position').notNull(),
    parentTaskId: text('parent_task_id').references((): any => task.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: text('created_by').notNull().references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('task_board_idx').on(t.projectId, t.statusId, t.position),
    index('task_assignee_idx').on(t.workspaceId, t.assigneeId, t.archivedAt),
    index('task_parent_idx').on(t.parentTaskId),
  ],
);

export const label = pgTable(
  'label',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull().default('muted'),
  },
  (t) => [uniqueIndex('label_workspace_name_uq').on(t.workspaceId, t.name)],
);

export const taskLabel = pgTable(
  'task_label',
  {
    taskId: text('task_id').notNull().references(() => task.id, { onDelete: 'cascade' }),
    labelId: text('label_id').notNull().references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })],
);
