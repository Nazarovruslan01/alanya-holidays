\set ON_ERROR_STOP on

\if :{?apply_fix}
\else
\set apply_fix false
\endif

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('38000000-0000-4000-8000-000000000001', 'forum-author@example.test'),
  ('38000000-0000-4000-8000-000000000002', 'forum-commenter@example.test'),
  ('38000000-0000-4000-8000-000000000003', 'forum-replier@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, role)
VALUES
  ('38000000-0000-4000-8000-000000000001', 'forum-author@example.test', 'Forum Author', 'user'),
  ('38000000-0000-4000-8000-000000000002', 'forum-commenter@example.test', 'Forum Commenter', 'user'),
  ('38000000-0000-4000-8000-000000000003', 'forum-replier@example.test', 'Forum Replier', 'user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.forum_posts (id, title, slug, body, author_id)
VALUES (
  '39000000-0000-4000-8000-000000000001',
  'Legacy notification types regression',
  'legacy-notification-types-regression',
  'Forum notification trigger regression fixture',
  '38000000-0000-4000-8000-000000000001'
);

-- Recreate the obsolete production constraint inside this transaction so the
-- first source write proves the observed SQLSTATE before applying the repair.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('info', 'success', 'warning', 'error'));

DO $$
DECLARE
  failure_state text;
  failure_constraint text;
BEGIN
  BEGIN
    INSERT INTO public.forum_comments (id, post_id, author_id, body)
    VALUES (
      '3a000000-0000-4000-8000-000000000001',
      '39000000-0000-4000-8000-000000000001',
      '38000000-0000-4000-8000-000000000002',
      'This source row must be rolled back with its rejected notification'
    );
    RAISE EXCEPTION 'legacy notification CHECK unexpectedly accepted FORUM_COMMENT';
  EXCEPTION
    WHEN check_violation THEN
      GET STACKED DIAGNOSTICS
        failure_state = RETURNED_SQLSTATE,
        failure_constraint = CONSTRAINT_NAME;
      IF failure_state <> '23514'
         OR failure_constraint <> 'notifications_type_check' THEN
        RAISE EXCEPTION 'expected notifications_type_check SQLSTATE 23514, got % from %',
          failure_state,
          failure_constraint;
      END IF;
  END;

  IF EXISTS (
    SELECT 1
    FROM public.forum_comments
    WHERE id = '3a000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'failed trigger notification did not roll back its source comment';
  END IF;
END;
$$;

\if :apply_fix
\ir ../migrations/20260908020000_fix_legacy_notification_types.sql
\endif

INSERT INTO public.forum_comments (id, post_id, author_id, body)
VALUES (
  '3a000000-0000-4000-8000-000000000010',
  '39000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002',
  'Cross-author top-level comment'
);

INSERT INTO public.forum_comments (id, post_id, author_id, parent_id, body)
VALUES (
  '3a000000-0000-4000-8000-000000000011',
  '39000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000003',
  '3a000000-0000-4000-8000-000000000010',
  'Cross-author reply'
);

INSERT INTO public.forum_post_likes (post_id, user_id)
VALUES (
  '39000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000002'
);

INSERT INTO public.forum_comment_likes (comment_id, user_id)
VALUES (
  '3a000000-0000-4000-8000-000000000010',
  '38000000-0000-4000-8000-000000000003'
);

-- Same-author activity persists but must not notify the actor.
INSERT INTO public.forum_comments (id, post_id, author_id, body)
VALUES (
  '3a000000-0000-4000-8000-000000000012',
  '39000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001',
  'Post author self-comment'
);

INSERT INTO public.forum_post_likes (post_id, user_id)
VALUES (
  '39000000-0000-4000-8000-000000000001',
  '38000000-0000-4000-8000-000000000001'
);

INSERT INTO public.forum_comment_likes (comment_id, user_id)
VALUES (
  '3a000000-0000-4000-8000-000000000010',
  '38000000-0000-4000-8000-000000000002'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass
      AND conname = 'notifications_type_check'
  ) THEN
    RAISE EXCEPTION 'obsolete notification type CHECK still exists';
  END IF;

  IF (SELECT count(*) FROM public.forum_comments
      WHERE id IN (
        '3a000000-0000-4000-8000-000000000010',
        '3a000000-0000-4000-8000-000000000011',
        '3a000000-0000-4000-8000-000000000012'
      )) <> 3
    OR (SELECT count(*) FROM public.forum_post_likes
        WHERE post_id = '39000000-0000-4000-8000-000000000001') <> 2
    OR (SELECT count(*) FROM public.forum_comment_likes
        WHERE comment_id = '3a000000-0000-4000-8000-000000000010') <> 2 THEN
    RAISE EXCEPTION 'forum source actions did not persist after dropping the obsolete CHECK';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = '38000000-0000-4000-8000-000000000001'
      AND actor_id = '38000000-0000-4000-8000-000000000002'
      AND type = 'FORUM_COMMENT'
      AND data->>'commentId' = '3a000000-0000-4000-8000-000000000010'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = '38000000-0000-4000-8000-000000000002'
      AND actor_id = '38000000-0000-4000-8000-000000000003'
      AND type = 'FORUM_REPLY'
      AND data->>'commentId' = '3a000000-0000-4000-8000-000000000011'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = '38000000-0000-4000-8000-000000000001'
      AND actor_id = '38000000-0000-4000-8000-000000000002'
      AND type = 'FORUM_LIKE'
      AND data->>'postId' = '39000000-0000-4000-8000-000000000001'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = '38000000-0000-4000-8000-000000000002'
      AND actor_id = '38000000-0000-4000-8000-000000000003'
      AND type = 'FORUM_COMMENT_LIKE'
      AND data->>'commentId' = '3a000000-0000-4000-8000-000000000010'
  ) THEN
    RAISE EXCEPTION 'one or more cross-author forum notifications did not persist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE user_id = actor_id
      AND (
        data->>'postId' = '39000000-0000-4000-8000-000000000001'
        OR data->>'commentId' IN (
          '3a000000-0000-4000-8000-000000000010',
          '3a000000-0000-4000-8000-000000000012'
        )
      )
  ) THEN
    RAISE EXCEPTION 'self-action notification suppression regressed';
  END IF;
END;
$$;

ROLLBACK;
