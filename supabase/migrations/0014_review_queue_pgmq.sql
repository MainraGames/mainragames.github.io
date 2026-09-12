-- 0014_review_queue_pgmq.sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgmq CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_net CASCADE;
CREATE EXTENSION IF NOT EXISTS pg_cron CASCADE;

-- Create pgmq queue if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'pgmq' AND tablename = 'q_review_replies_queue'
  ) THEN
    PERFORM pgmq.create('review_replies_queue');
  END IF;
END $$;

-- Trigger function: Enqueue 5-star reviews without developer reply
CREATE OR REPLACE FUNCTION public.enqueue_5star_review_for_reply()
RETURNS trigger AS $$
BEGIN
  -- Only enqueue 5-star reviews that don't have a developer reply yet
  IF NEW.star_rating = 5 AND (NEW.reply_text IS NULL OR trim(NEW.reply_text) = '') THEN
    PERFORM pgmq.send(
      'review_replies_queue',
      jsonb_build_object(
        'review_id', NEW.review_id,
        'game_id', NEW.game_id,
        'author_name', coalesce(NEW.author_name, 'Player'),
        'content', coalesce(NEW.content, ''),
        'star_rating', NEW.star_rating,
        'lang', coalesce(NEW.lang, 'id'),
        'source', coalesce(NEW.source, 'playstore')
      )
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to game_reviews table
DROP TRIGGER IF EXISTS trg_enqueue_5star_review ON public.game_reviews;
CREATE TRIGGER trg_enqueue_5star_review
AFTER INSERT ON public.game_reviews
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_5star_review_for_reply();
