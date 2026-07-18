create table if not exists booking_holds (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hold_token_hash text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (expires_at > created_at)
);

alter table booking_holds enable row level security;

drop policy if exists "professionals read own booking holds" on booking_holds;
create policy "professionals read own booking holds"
  on booking_holds for select
  to authenticated
  using ((select auth.uid()) = professional_id);

create index if not exists booking_holds_expires_idx on booking_holds (expires_at)
  where consumed_at is null;

alter table booking_holds
  drop constraint if exists booking_holds_no_overlap;

alter table booking_holds
  add constraint booking_holds_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (consumed_at is null);

create or replace function public.create_public_booking_hold(
  p_slug text,
  p_starts_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_prof professionals%rowtype;
  v_profile public_profiles%rowtype;
  v_duration integer;
  v_ends_at timestamptz;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_hold booking_holds%rowtype;
  v_start_local_time time;
  v_weekday integer;
begin
  select pp.* into v_profile
  from public_profiles pp
  where pp.slug = p_slug and pp.published = true
  limit 1;

  if v_profile.id is null then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  select p.* into v_prof
  from professionals p
  where p.id = v_profile.professional_id and p.active = true;

  if v_prof.id is null then
    raise exception 'professional_inactive' using errcode = '22023';
  end if;

  delete from booking_holds
  where professional_id = v_prof.id
    and consumed_at is null
    and expires_at <= now();

  v_duration := coalesce(v_prof.default_session_duration_minutes, 50);
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;
  v_start_local_time := (p_starts_at at time zone v_prof.timezone)::time;
  v_weekday := extract(dow from (p_starts_at at time zone v_prof.timezone)::date)::int;

  if p_starts_at <= now() + interval '2 hours' then
    raise exception 'slot_too_soon' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from availability_rules r
    where r.professional_id = v_prof.id
      and r.active = true
      and r.weekday = v_weekday
      and v_start_local_time >= r.start_time
      and (v_start_local_time + (v_duration || ' minutes')::interval)::time <= r.end_time
  ) then
    raise exception 'slot_outside_availability' using errcode = '22023';
  end if;

  if exists (
    select 1
    from appointments a
    where a.professional_id = v_prof.id
      and a.status in ('requested', 'scheduled', 'confirmed')
      and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'slot_conflict' using errcode = '23P01';
  end if;

  if exists (
    select 1
    from availability_exceptions e
    where e.professional_id = v_prof.id
      and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'slot_blocked' using errcode = '22023';
  end if;

  insert into booking_holds (professional_id, starts_at, ends_at, hold_token_hash, expires_at)
  values (v_prof.id, p_starts_at, v_ends_at, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '10 minutes')
  returning * into v_hold;

  return jsonb_build_object(
    'hold_id', v_hold.id,
    'hold_token', v_token,
    'starts_at', v_hold.starts_at,
    'ends_at', v_hold.ends_at,
    'expires_at', v_hold.expires_at
  );
exception
  when exclusion_violation then
    raise exception 'slot_conflict' using errcode = '23P01';
end;
$function$;

create or replace function public.release_public_booking_hold(
  p_hold_id uuid,
  p_hold_token text
)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  update booking_holds
  set consumed_at = coalesce(consumed_at, now())
  where id = p_hold_id
    and hold_token_hash = encode(digest(coalesce(p_hold_token, ''), 'sha256'), 'hex')
    and consumed_at is null;

  return found;
end;
$function$;

drop function if exists public.create_public_booking(text, timestamptz, text, text, text, text, boolean);

create function public.create_public_booking(
  p_slug text,
  p_starts_at timestamptz,
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_initial_note text default null,
  p_consent boolean default false,
  p_hold_id uuid default null,
  p_hold_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_prof professionals%rowtype;
  v_profile public_profiles%rowtype;
  v_patient patients%rowtype;
  v_episode treatment_episodes%rowtype;
  v_appointment appointments%rowtype;
  v_hold booking_holds%rowtype;
  v_duration integer;
  v_ends_at timestamptz;
  v_token text := encode(gen_random_bytes(24), 'hex');
  v_phone text := nullif(trim(p_phone), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_start_local_time time;
  v_weekday integer;
begin
  if not coalesce(p_consent, false) then raise exception 'consent_required' using errcode = '22023'; end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 then raise exception 'full_name_required' using errcode = '22023'; end if;
  if v_phone is null and v_email is null then raise exception 'contact_required' using errcode = '22023'; end if;

  select pp.* into v_profile from public_profiles pp where pp.slug = p_slug and pp.published = true limit 1;
  if v_profile.id is null then raise exception 'profile_not_found' using errcode = '22023'; end if;

  select p.* into v_prof from professionals p where p.id = v_profile.professional_id and p.active = true;
  if v_prof.id is null then raise exception 'professional_inactive' using errcode = '22023'; end if;

  delete from booking_holds
  where professional_id = v_prof.id
    and consumed_at is null
    and expires_at <= now();

  v_duration := coalesce(v_prof.default_session_duration_minutes, 50);
  v_ends_at := p_starts_at + (v_duration || ' minutes')::interval;
  v_start_local_time := (p_starts_at at time zone v_prof.timezone)::time;
  v_weekday := extract(dow from (p_starts_at at time zone v_prof.timezone)::date)::int;

  if p_starts_at <= now() + interval '2 hours' then raise exception 'slot_too_soon' using errcode = '22023'; end if;

  if not exists (
    select 1 from availability_rules r
    where r.professional_id = v_prof.id
      and r.active = true
      and r.weekday = v_weekday
      and v_start_local_time >= r.start_time
      and (v_start_local_time + (v_duration || ' minutes')::interval)::time <= r.end_time
  ) then
    raise exception 'slot_outside_availability' using errcode = '22023';
  end if;

  if exists (
    select 1 from availability_exceptions e
    where e.professional_id = v_prof.id
      and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
  ) then
    raise exception 'slot_blocked' using errcode = '22023';
  end if;

  if p_hold_id is not null then
    select * into v_hold
    from booking_holds h
    where h.id = p_hold_id
      and h.professional_id = v_prof.id
      and h.starts_at = p_starts_at
      and h.hold_token_hash = encode(digest(coalesce(p_hold_token, ''), 'sha256'), 'hex')
      and h.consumed_at is null
      and h.expires_at > now()
    limit 1;

    if v_hold.id is null then
      raise exception 'hold_expired' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from booking_holds h
    where h.professional_id = v_prof.id
      and h.consumed_at is null
      and h.expires_at > now()
      and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(p_starts_at, v_ends_at, '[)')
      and not (p_hold_id is not null and h.id = p_hold_id)
  ) then
    raise exception 'slot_conflict' using errcode = '23P01';
  end if;

  select * into v_patient
  from patients p
  where p.professional_id = v_prof.id
    and (
      (v_email is not null and lower(coalesce(p.email, '')) = v_email)
      or (v_phone is not null and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g'))
    )
  order by p.created_at desc
  limit 1;

  if v_patient.id is null then
    insert into patients (professional_id, full_name, email, phone, first_contact_note)
    values (v_prof.id, trim(p_full_name), v_email, v_phone, nullif(trim(coalesce(p_initial_note, '')), ''))
    returning * into v_patient;
  else
    update patients
    set full_name = trim(p_full_name),
        email = coalesce(v_email, email),
        phone = coalesce(v_phone, phone),
        first_contact_note = coalesce(nullif(trim(coalesce(p_initial_note, '')), ''), first_contact_note)
    where id = v_patient.id
    returning * into v_patient;
  end if;

  select * into v_episode
  from treatment_episodes te
  where te.professional_id = v_prof.id
    and te.patient_id = v_patient.id
    and te.status in ('triage', 'active')
  order by te.created_at desc
  limit 1;

  if v_episode.id is null then
    insert into treatment_episodes (professional_id, patient_id, status, main_complaint)
    values (v_prof.id, v_patient.id, 'triage', nullif(trim(coalesce(p_initial_note, '')), ''))
    returning * into v_episode;
  end if;

  insert into appointments (professional_id, patient_id, treatment_episode_id, starts_at, ends_at, status, appointment_type, source, public_manage_token_hash)
  values (v_prof.id, v_patient.id, v_episode.id, p_starts_at, v_ends_at, 'scheduled', 'online', 'public_booking', encode(digest(v_token, 'sha256'), 'hex'))
  returning * into v_appointment;

  if v_hold.id is not null then
    update booking_holds
    set consumed_at = now()
    where id = v_hold.id;
  end if;

  if v_email is not null then insert into notification_jobs (professional_id, appointment_id, channel, template_key, recipient, status) values (v_prof.id, v_appointment.id, 'email', 'appointment_confirmation', v_email, 'pending'); end if;
  if v_phone is not null then insert into notification_jobs (professional_id, appointment_id, channel, template_key, recipient, status) values (v_prof.id, v_appointment.id, 'whatsapp', 'appointment_confirmation', v_phone, 'pending'); end if;

  insert into audit_logs (professional_id, action, entity_table, entity_id, metadata)
  values (v_prof.id, 'public_booking_created', 'appointments', v_appointment.id, jsonb_build_object('source', 'public_booking', 'hold_id', v_hold.id));

  return jsonb_build_object('appointment', to_jsonb(v_appointment), 'patient', jsonb_build_object('id', v_patient.id, 'full_name', v_patient.full_name), 'manage_token', v_token);
exception
  when exclusion_violation then raise exception 'slot_conflict' using errcode = '23P01';
end;
$function$;

create or replace function public.get_public_booking_page(
  p_slug text default 'dra-clara-menezes',
  p_days integer default 21
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_prof professionals%rowtype;
  v_profile public_profiles%rowtype;
  v_slots jsonb;
begin
  select pp.* into v_profile from public_profiles pp where pp.slug = p_slug and pp.published = true limit 1;
  if v_profile.id is null then return jsonb_build_object('profile', null, 'professional', null, 'slots', '[]'::jsonb); end if;

  select p.* into v_prof from professionals p where p.id = v_profile.professional_id and p.active = true;
  if v_prof.id is null then return jsonb_build_object('profile', to_jsonb(v_profile), 'professional', null, 'slots', '[]'::jsonb); end if;

  delete from booking_holds
  where professional_id = v_prof.id
    and consumed_at is null
    and expires_at <= now();

  with candidate_days as (
    select generate_series(current_date, current_date + greatest(1, least(p_days, 45)), interval '1 day')::date as day
  ), candidate_slots as (
    select
      r.id as rule_id,
      d.day,
      gs.local_start as local_start,
      (gs.local_start at time zone v_prof.timezone) as starts_at,
      ((gs.local_start + (r.slot_duration_minutes || ' minutes')::interval) at time zone v_prof.timezone) as ends_at
    from candidate_days d
    join availability_rules r
      on r.professional_id = v_prof.id
     and r.active = true
     and r.weekday = extract(dow from d.day)::int
    cross join lateral generate_series(
      (d.day + r.start_time)::timestamp,
      (d.day + r.end_time - (r.slot_duration_minutes || ' minutes')::interval)::timestamp,
      ((r.slot_duration_minutes + r.buffer_after_minutes) || ' minutes')::interval
    ) as gs(local_start)
  ), available as (
    select * from candidate_slots cs
    where cs.starts_at > now() + interval '2 hours'
      and not exists (
        select 1 from appointments a
        where a.professional_id = v_prof.id
          and a.status in ('requested', 'scheduled', 'confirmed')
          and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(cs.starts_at, cs.ends_at, '[)')
      )
      and not exists (
        select 1 from booking_holds h
        where h.professional_id = v_prof.id
          and h.consumed_at is null
          and h.expires_at > now()
          and tstzrange(h.starts_at, h.ends_at, '[)') && tstzrange(cs.starts_at, cs.ends_at, '[)')
      )
      and not exists (
        select 1 from availability_exceptions e
        where e.professional_id = v_prof.id
          and tstzrange(e.starts_at, e.ends_at, '[)') && tstzrange(cs.starts_at, cs.ends_at, '[)')
      )
    order by starts_at
    limit 36
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'starts_at', starts_at,
    'ends_at', ends_at,
    'day_label', to_char(starts_at at time zone v_prof.timezone, 'DD/MM'),
    'date', to_char(starts_at at time zone v_prof.timezone, 'YYYY-MM-DD'),
    'time', to_char(starts_at at time zone v_prof.timezone, 'HH24:MI')
  ) order by starts_at), '[]'::jsonb)
  into v_slots
  from available;

  return jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'professional', to_jsonb(v_prof) - 'created_at' - 'updated_at',
    'slots', v_slots
  );
end;
$function$;

grant execute on function public.create_public_booking_hold(text, timestamptz) to anon, authenticated;
grant execute on function public.release_public_booking_hold(uuid, text) to anon, authenticated;
grant execute on function public.create_public_booking(text, timestamptz, text, text, text, text, boolean, uuid, text) to anon, authenticated;
grant execute on function public.get_public_booking_page(text, integer) to anon, authenticated;
