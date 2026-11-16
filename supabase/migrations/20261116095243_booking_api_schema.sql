create table if not exists public.slots (
  id text primary key,
  provider text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  constraint slots_valid_range check (ends_at > starts_at)
);

create table if not exists public.bookings (
  id text primary key default gen_random_uuid()::text,
  slot_id text not null references public.slots(id) on delete cascade,
  name text not null,
  email text not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists bookings_one_confirmed_per_slot
  on public.bookings(slot_id)
  where status = 'confirmed';

create index if not exists bookings_email_created_idx
  on public.bookings(lower(email), created_at, id);

create table if not exists public.booking_attempts (
  email text not null,
  attempted_at timestamptz not null
);

create index if not exists booking_attempts_email_time_idx
  on public.booking_attempts(email, attempted_at);

create table if not exists public.idempotency_records (
  key text primary key,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.booking_api_settings (
  id integer primary key check (id = 1),
  key_hash text not null
);

alter table public.slots enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_attempts enable row level security;
alter table public.idempotency_records enable row level security;
alter table public.booking_api_settings enable row level security;

revoke all on public.slots, public.bookings, public.booking_attempts,
  public.idempotency_records from anon, authenticated;
revoke all on public.booking_api_settings from anon, authenticated;
grant all on public.slots, public.bookings, public.booking_attempts,
  public.idempotency_records to service_role;
grant all on public.booking_api_settings to service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.booking_api_key_valid(p_api_key text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select p_api_key is not null and exists (
    select 1 from public.booking_api_settings
    where id = 1
      and key_hash = encode(extensions.digest(convert_to(p_api_key, 'UTF8'), 'sha256'), 'hex')
  );
$$;

create or replace function public.reset_slots(p_api_key text, p_slots jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slot jsonb;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  if jsonb_typeof(p_slots) is distinct from 'array' then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'slots must be an array'));
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_slots) as item(value)
    where jsonb_typeof(value) <> 'object'
      or nullif(btrim(value->>'id'), '') is null
      or nullif(btrim(value->>'provider'), '') is null
      or nullif(btrim(value->>'start'), '') is null
      or nullif(btrim(value->>'end'), '') is null
  ) then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid slot'));
  end if;

  delete from public.bookings;
  delete from public.slots;
  delete from public.booking_attempts;
  delete from public.idempotency_records;

  for v_slot in select value from jsonb_array_elements(p_slots) as item(value)
  loop
    insert into public.slots(id, provider, starts_at, ends_at)
    values (
      btrim(v_slot->>'id'),
      btrim(v_slot->>'provider'),
      (v_slot->>'start')::timestamptz,
      (v_slot->>'end')::timestamptz
    );
  end loop;

  return jsonb_build_object('status', 200, 'body', jsonb_build_object('ok', true));
exception
  when others then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid slots'));
end;
$$;

create or replace function public.create_booking(
  p_api_key text,
  p_slot_id text,
  p_name text,
  p_email text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_now timestamptz := clock_timestamp();
  v_attempt_count integer;
  v_oldest_attempt timestamptz;
  v_retry_after integer;
  v_existing_hash text;
  v_existing_response jsonb;
  v_slot_start timestamptz;
  v_booking public.bookings%rowtype;
  v_response jsonb;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    perform pg_advisory_xact_lock(hashtextextended('idempotency:' || p_idempotency_key, 0));
    select request_hash, response
      into v_existing_hash, v_existing_response
      from public.idempotency_records
      where key = p_idempotency_key;
    if found then
      if v_existing_hash <> p_request_hash then
        return jsonb_build_object('status', 422, 'body', jsonb_build_object('error', 'idempotency key reused with a different body'));
      end if;
      return v_existing_response;
    end if;
  end if;

  <<operation>>
  begin
    if v_email <> '' then
      perform pg_advisory_xact_lock(hashtextextended('booking-rate:' || v_email, 0));
      delete from public.booking_attempts
        where email = v_email and attempted_at <= v_now - interval '1 minute';
      select count(*), min(attempted_at)
        into v_attempt_count, v_oldest_attempt
        from public.booking_attempts
        where email = v_email and attempted_at > v_now - interval '1 minute';
      if v_attempt_count >= 5 then
        v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_attempt + interval '1 minute' - v_now))::integer));
        v_response := jsonb_build_object(
          'status', 429,
          'body', jsonb_build_object('error', 'too many booking attempts'),
          'retry_after', v_retry_after
        );
        exit operation;
      end if;
      insert into public.booking_attempts(email, attempted_at) values (v_email, v_now);
    end if;

    if p_slot_id is null or btrim(p_slot_id) = '' or v_name = '' or v_email = '' then
      v_response := jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'slot_id, name and email are required'));
      exit operation;
    end if;

    if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      v_response := jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'email is invalid'));
      exit operation;
    end if;

    select starts_at into v_slot_start from public.slots where id = btrim(p_slot_id);
    if not found then
      v_response := jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'slot not found'));
      exit operation;
    end if;

    if v_slot_start <= v_now then
      v_response := jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'slot has already started'));
      exit operation;
    end if;

    insert into public.bookings(slot_id, name, email)
    values (btrim(p_slot_id), v_name, v_email)
    on conflict (slot_id) where status = 'confirmed' do nothing
    returning * into v_booking;

    if not found then
      v_response := jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'slot already booked'));
      exit operation;
    end if;

    v_response := jsonb_build_object('status', 201, 'body', to_jsonb(v_booking));
  end operation;

  if p_idempotency_key is not null and p_idempotency_key <> '' then
    insert into public.idempotency_records(key, request_hash, response)
    values (p_idempotency_key, p_request_hash, v_response);
  end if;

  return v_response;
end;
$$;

create or replace function public.cancel_booking(p_api_key text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  select * into v_booking from public.bookings where id = p_id for update;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'booking not found'));
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('status', 409, 'body', jsonb_build_object('error', 'booking already cancelled'));
  end if;

  update public.bookings set status = 'cancelled' where id = p_id returning * into v_booking;
  return jsonb_build_object('status', 200, 'body', to_jsonb(v_booking));
end;
$$;

create or replace function public.list_bookings(
  p_api_key text,
  p_email text,
  p_limit integer default 10,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_cursor_created_at timestamptz;
  v_cursor_id text;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
  v_next_cursor text;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  if v_email = '' then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'email is required'));
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'limit must be between 1 and 50'));
  end if;

  if p_cursor is not null and p_cursor <> '' then
    begin
      v_cursor_created_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_cursor_id := split_part(p_cursor, '|', 2);
      if v_cursor_id = '' or position('|' in substring(p_cursor from position('|' in p_cursor) + 1)) > 0 then
        raise exception 'invalid cursor';
      end if;
    exception when others then
      return jsonb_build_object('status', 400, 'body', jsonb_build_object('error', 'invalid cursor'));
    end;
  end if;

  select coalesce(jsonb_agg(to_jsonb(page) order by page.created_at, page.id), '[]'::jsonb)
    into v_rows
    from (
      select id, slot_id, name, email, status, created_at
      from public.bookings b
      where lower(b.email) = v_email
        and (v_cursor_created_at is null or (b.created_at, b.id) > (v_cursor_created_at, v_cursor_id))
      order by b.created_at, b.id
      limit p_limit + 1
    ) as page;

  v_count := jsonb_array_length(v_rows);
  if v_count > p_limit then
    v_last := v_rows -> (p_limit - 1);
    v_next_cursor := (v_last ->> 'created_at') || '|' || (v_last ->> 'id');
    v_rows := v_rows - (v_count - 1);
  end if;

  return jsonb_build_object(
    'status', 200,
    'body', jsonb_build_object('bookings', v_rows, 'next_cursor', v_next_cursor)
  );
end;
$$;

create or replace function public.list_slots(p_api_key text, p_provider text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slots jsonb;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'provider', s.provider,
      'start', s.starts_at,
      'end', s.ends_at,
      'available', not exists (
        select 1 from public.bookings b
        where b.slot_id = s.id and b.status = 'confirmed'
      )
    ) order by s.starts_at, s.id
  ), '[]'::jsonb)
  into v_slots
  from public.slots s
  where p_provider is null or s.provider = p_provider;

  return jsonb_build_object('status', 200, 'body', jsonb_build_object('slots', v_slots));
end;
$$;

create or replace function public.get_booking(p_api_key text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking public.bookings%rowtype;
begin
  if not public.booking_api_key_valid(p_api_key) then
    return jsonb_build_object('status', 401, 'body', jsonb_build_object('error', 'unauthorized'));
  end if;

  select * into v_booking from public.bookings where id = p_id;
  if not found then
    return jsonb_build_object('status', 404, 'body', jsonb_build_object('error', 'booking not found'));
  end if;
  return jsonb_build_object('status', 200, 'body', to_jsonb(v_booking));
end;
$$;

revoke all on function public.booking_api_key_valid(text) from public, anon, authenticated;
revoke all on function public.reset_slots(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_booking(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_booking(text, text) from public, anon, authenticated;
revoke all on function public.list_bookings(text, text, integer, text) from public, anon, authenticated;
revoke all on function public.list_slots(text, text) from public, anon, authenticated;
revoke all on function public.get_booking(text, text) from public, anon, authenticated;
grant execute on function public.reset_slots(text, jsonb) to anon, service_role;
grant execute on function public.create_booking(text, text, text, text, text, text) to anon, service_role;
grant execute on function public.cancel_booking(text, text) to anon, service_role;
grant execute on function public.list_bookings(text, text, integer, text) to anon, service_role;
grant execute on function public.list_slots(text, text) to anon, service_role;
grant execute on function public.get_booking(text, text) to anon, service_role;