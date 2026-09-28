import { LIST_PAGE_SIZE } from '@/lib/task-table-sort';

/** Every List table column, in its default order. */
export const TABLE_COLUMNS = ['title', 'status', 'priority', 'assignee', 'due', 'created', 'updated', 'labels'] as const;
export type TableColumn = (typeof TABLE_COLUMNS)[number];

export const COLUMN_LABEL: Record<TableColumn, string> = {
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  assignee: 'Assignee',
  due: 'Due',
  created: 'Created',
  updated: 'Updated',
  labels: 'Labels',
};

/** Title is the row's handle — sticky, and the keyboard's way in — so it stays first and shown. */
export const PINNED_COLUMN: TableColumn = 'title';

export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export type TableSettings = {
  columnOrder: TableColumn[];
  hidden: TableColumn[];
  density: Density;
  pageSize: PageSize;
};

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  columnOrder: [...TABLE_COLUMNS],
  hidden: [],
  density: 'comfortable',
  pageSize: LIST_PAGE_SIZE as PageSize,
};

/** Settings live per browser, per project. */
export function tableSettingsKey(projectId: string): string {
  return `taskeeper:list-settings:${projectId}`;
}

function isColumn(value: unknown): value is TableColumn {
  return (TABLE_COLUMNS as readonly unknown[]).includes(value);
}

function columns(value: unknown): TableColumn[] {
  return Array.isArray(value) ? [...new Set(value.filter(isColumn))] : [];
}

/**
 * Whatever is stored, a usable shape comes back: unknown columns drop out,
 * columns added since the settings were saved join at the end, Title is first
 * and shown, and an unknown density or page size means the default.
 */
export function parseTableSettings(raw: string | null | undefined): TableSettings {
  let stored: unknown;
  try {
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== 'object') return DEFAULT_TABLE_SETTINGS;
  const { columnOrder, hidden, density, pageSize } = stored as Record<string, unknown>;

  const order = columns(columnOrder).filter((c) => c !== PINNED_COLUMN);
  const missing = TABLE_COLUMNS.filter((c) => c !== PINNED_COLUMN && !order.includes(c));

  return {
    columnOrder: [PINNED_COLUMN, ...order, ...missing],
    hidden: columns(hidden).filter((c) => c !== PINNED_COLUMN),
    density: (DENSITIES as readonly unknown[]).includes(density)
      ? (density as Density)
      : DEFAULT_TABLE_SETTINGS.density,
    pageSize: (PAGE_SIZES as readonly unknown[]).includes(pageSize)
      ? (pageSize as PageSize)
      : DEFAULT_TABLE_SETTINGS.pageSize,
  };
}
