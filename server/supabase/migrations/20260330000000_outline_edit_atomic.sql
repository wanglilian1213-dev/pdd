CREATE OR REPLACE FUNCTION reserve_outline_edit(
  p_task_id UUID,
  p_user_id UUID,
  p_max_edits INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
BEGIN
  SELECT *
    INTO v_task
    FROM tasks
   WHERE id = p_task_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN';
  END IF;

  IF v_task.status <> 'processing' OR v_task.stage <> 'outline_ready' THEN
    RAISE EXCEPTION 'TASK_NOT_READY';
  END IF;

  IF v_task.outline_edits_used >= p_max_edits THEN
    RAISE EXCEPTION 'OUTLINE_EDIT_LIMIT_REACHED';
  END IF;

  UPDATE tasks
     SET outline_edits_used = outline_edits_used + 1,
         updated_at = NOW()
   WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'outlineEditsUsed', v_task.outline_edits_used + 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION release_outline_edit(
  p_task_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task tasks%ROWTYPE;
  v_new_outline_edits INTEGER;
BEGIN
  SELECT *
    INTO v_task
    FROM tasks
   WHERE id = p_task_id
     AND user_id = p_user_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND_OR_FORBIDDEN';
  END IF;

  v_new_outline_edits := GREATEST(v_task.outline_edits_used - 1, 0);

  UPDATE tasks
     SET outline_edits_used = v_new_outline_edits,
         updated_at = NOW()
   WHERE id = p_task_id;

  RETURN jsonb_build_object(
    'taskId', p_task_id,
    'outlineEditsUsed', v_new_outline_edits
  );
END;
$$;
