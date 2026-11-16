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
        v_retry_after := greatest(1, ceil(extract(epoch from (v_oldest_attempt + interval '1 minute' - v_now)))::integer);
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
