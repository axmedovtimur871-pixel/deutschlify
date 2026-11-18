-- Deutschlify · speech: storage bucket for generated audio and a site-wide daily character budget.
-- Additive only.

insert into storage.buckets (id, name, public)
values ('tts', 'tts', true)
on conflict (id) do nothing;

create table if not exists public.tts_daily (
  day date primary key default current_date,
  chars integer not null default 0
);
alter table public.tts_daily enable row level security;
-- No policies on purpose: only the Edge Function (service role) reads or writes this table.

-- Adds p_chars to today's total and returns true, or returns false when that would exceed p_limit.
create or replace function public.bump_tts_usage(p_chars integer, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
begin
  insert into public.tts_daily (day, chars)
  values (current_date, p_chars)
  on conflict (day) do update
    set chars = public.tts_daily.chars + p_chars
    where public.tts_daily.chars + p_chars <= p_limit
  returning chars into v_total;
  return v_total is not null and v_total <= p_limit;
end;
$$;

revoke all on function public.bump_tts_usage(integer, integer) from public, anon, authenticated;
grant execute on function public.bump_tts_usage(integer, integer) to service_role;
