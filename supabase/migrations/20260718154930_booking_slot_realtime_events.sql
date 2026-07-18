create table if not exists booking_slot_events (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  event_kind text not null check (event_kind in ('hold_created', 'hold_released', 'appointment_changed')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table booking_slot_events enable row level security;

drop policy if exists "public can read published booking slot events" on booking_slot_events;
create policy "public can read published booking slot events"
  on booking_slot_events for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public_profiles
      where public_profiles.professional_id = booking_slot_events.professional_id
        and public_profiles.published = true
    )
  );

create index if not exists booking_slot_events_professional_created_idx
  on booking_slot_events (professional_id, created_at desc);

create or replace function public.emit_booking_slot_event()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_event_kind text;
begin
  if tg_table_name = 'booking_holds' then
    if tg_op = 'INSERT' then
      v_event_kind := 'hold_created';
    elsif tg_op = 'UPDATE'
      and old.consumed_at is null
      and new.consumed_at is not null then
      v_event_kind := 'hold_released';
    else
      return new;
    end if;

    insert into booking_slot_events (professional_id, starts_at, event_kind, expires_at)
    values (new.professional_id, new.starts_at, v_event_kind, new.expires_at);
  elsif tg_table_name = 'appointments' then
    if tg_op not in ('INSERT', 'UPDATE') then
      return new;
    end if;

    insert into booking_slot_events (professional_id, starts_at, event_kind, expires_at)
    values (new.professional_id, new.starts_at, 'appointment_changed', null);
  end if;

  delete from booking_slot_events
  where created_at < now() - interval '2 days';

  return new;
end;
$function$;

drop trigger if exists booking_holds_emit_slot_event on booking_holds;
create trigger booking_holds_emit_slot_event
  after insert or update on booking_holds
  for each row
  execute function public.emit_booking_slot_event();

drop trigger if exists appointments_emit_slot_event on appointments;
create trigger appointments_emit_slot_event
  after insert or update on appointments
  for each row
  execute function public.emit_booking_slot_event();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_slot_events'
  ) then
    alter publication supabase_realtime add table booking_slot_events;
  end if;
end $$;
