-- Subtasks created before subtask_position existed take their board key as
-- their order. position values are valid fractional keys, and position then id
-- is the order the detail view showed them in, so nothing visibly moves. Keys
-- may tie across columns; reorders renumber on a tie. Safe to rerun.
UPDATE task
SET subtask_position = position
WHERE parent_task_id IS NOT NULL
  AND subtask_position IS NULL;
