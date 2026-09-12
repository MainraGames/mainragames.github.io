-- 0015_pgmq_rpc_helpers.sql
-- Helper functions for pgmq operations callable from Edge Functions / Service Role

CREATE OR REPLACE FUNCTION public.read_review_queue(p_count integer DEFAULT 5, p_vt integer DEFAULT 120)
RETURNS TABLE (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamp with time zone,
  vt timestamp with time zone,
  message jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
  FROM pgmq.read('review_replies_queue', p_vt, p_count) m;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.archive_review_queue(p_msg_id bigint)
RETURNS boolean AS $$
BEGIN
  PERFORM pgmq.archive('review_replies_queue', p_msg_id);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  PERFORM pgmq.delete('review_replies_queue', p_msg_id);
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_review_queue(p_msg_id bigint)
RETURNS boolean AS $$
BEGIN
  PERFORM pgmq.delete('review_replies_queue', p_msg_id);
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
