-- =====================================================================================
--  Migration 002: Add ticket management and admin columns
--  Run this in Supabase SQL Editor after 001 (schema.sql)
-- =====================================================================================

-- Add ticket management columns
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS ticket_status VARCHAR(20) DEFAULT 'open';
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS ticket_priority VARCHAR(20);
ALTER TABLE public.submissions ADD COLUMN IF NOT EXISTS reward_code VARCHAR(20);

-- Add SELECT policy for anon role (needed for admin dashboard to read data)
DROP POLICY IF EXISTS "Allow public select" ON public.submissions;
CREATE POLICY "Allow public select" ON public.submissions
  FOR SELECT
  TO anon
  USING (true);

-- Performance indexes
CREATE INDEX IF NOT EXISTS submissions_ticket_status_idx ON public.submissions(ticket_status);
CREATE INDEX IF NOT EXISTS submissions_status_idx ON public.submissions(status);
CREATE INDEX IF NOT EXISTS submissions_completed_at_idx ON public.submissions(completed_at DESC);
