import { TodoList } from '@/components/todo/TodoList';
import { requireWorkspace } from '@/lib/session';
import { listTodos } from '@/server/todos/queries';

export default async function TodoPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const lists = await listTodos(ctx);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 lg:px-6">
      <h1 className="text-title-h5 text-text-strong-950">To-do</h1>
      <p className="mt-1 text-paragraph-sm text-text-sub-600">
        Your personal checklist for this workspace. Only you can see it.
      </p>
      <TodoList workspaceSlug={workspaceSlug} timezone={ctx.timezone} lists={lists} />
    </main>
  );
}
