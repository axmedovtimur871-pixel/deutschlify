-- Deutschlify · AI Lehrer: per-user daily message allowance
-- Additive only. Not applied yet: the database was paused when this file was written.

alter table public.usage_daily add column if not exists messages integer not null default 0;

-- Counts one AI message for the user today and returns the new count,
-- or NULL when the daily limit is already reached. Atomic, so parallel requests cannot overshoot.
create or replace function public.bump_ai_usage(p_user uuid, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.usage_daily (user_id, day, messages)
  values (p_user, current_date, 1)
  on conflict (user_id, day) do update
    set messages = public.usage_daily.messages + 1
    where public.usage_daily.messages < p_limit
  returning messages into v_count;
  return v_count;
end;
$$;

-- Only the Edge Function (service role) may call it.
revoke all on function public.bump_ai_usage(uuid, integer) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid, integer) to service_role;
