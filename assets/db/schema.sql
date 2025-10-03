-- Supabase schema for Mendokoro / Yushoken food truck survey
-- Run inside the SQL editor or via supabase cli: supabase db remote commit < file

-- Required extensions -------------------------------------------------------
create extension if not exists "pgcrypto";

-- Helper to auto-update timestamps-------------------------------------------
create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

-- Main submissions table ----------------------------------------------------
create table if not exists public.survey_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),

  -- gate details / credentials
  brand text,
  flow text,
  has_receipt boolean default false,
  receipt_no text not null,
  email text not null,
  name text,
  consent boolean default false,
  subscribed boolean default false,

  -- survey payload
  reward_code text,
  answers jsonb not null default '{}'::jsonb,

  q1 text,
  q2_choice text,
  q2_other text,
  q3 text,
  q3_branch text,
  q4 text,
  q4_city text,
  q4_mall text,
  q5 text,
  q5_place text,
  q7_food smallint,
  q7_food_comment text,
  q7_service smallint,
  q7_service_comment text,
  q7_price smallint,
  q7_price_comment text,
  q8_nps smallint,
  q8_comment text,
  q8_comment_type text,
  q10_return smallint,
  q10_return_comment text,
  q10_return_comment_type text,
  q9_choices text[],
  q9_other text,
  q9_comment text,
  q10 text
);

create index if not exists survey_submissions_receipt_idx on public.survey_submissions using btree (receipt_no);
create index if not exists survey_submissions_created_idx on public.survey_submissions using btree (created_at desc);
create index if not exists survey_submissions_answers_gin on public.survey_submissions using gin (answers);

create trigger set_timestamp
before update on public.survey_submissions
for each row execute function public.trigger_set_timestamp();

-- Row Level Security -------------------------------------------------------
alter table public.survey_submissions enable row level security;

drop policy if exists "allow insert via anon" on public.survey_submissions;
create policy "allow insert via anon" on public.survey_submissions
  for insert
  with check (true);

drop policy if exists "allow update via anon" on public.survey_submissions;
create policy "allow update via anon" on public.survey_submissions
  for update
  using (true)
  with check (true);

drop policy if exists "allow returning via anon" on public.survey_submissions;
create policy "allow returning via anon" on public.survey_submissions
  for select
  using ( auth.uid() is null ); -- allow returning/reads from client key, but block authenticated users
