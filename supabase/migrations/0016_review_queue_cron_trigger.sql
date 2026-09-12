-- 0016_review_queue_cron_trigger.sql
-- Helper SQL function to dispatch pg_net HTTP call to process-review-queue edge function
CREATE OR REPLACE FUNCTION public.trigger_process_review_queue()
RETURNS void AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://mjuzjvyatunjmgaiqtdv.supabase.co/functions/v1/process-review-queue',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"source": "pg_cron_or_trigger"}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Schedule pg_cron to periodically drain queue every 2 minutes
SELECT cron.unschedule('process-5star-reviews-queue') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-5star-reviews-queue'
);

SELECT cron.schedule(
  'process-5star-reviews-queue',
  '*/2 * * * *',
  $$SELECT public.trigger_process_review_queue();$$
);

-- Update the enqueue trigger so that immediately after enqueuing, it pings the worker
CREATE OR REPLACE FUNCTION public.enqueue_5star_review_for_reply()
RETURNS trigger AS $$
BEGIN
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
    -- Proactively notify the worker via pg_net async HTTP
    PERFORM public.trigger_process_review_queue();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
