create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type appointment_status as enum (
  'requested',
  'scheduled',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
  'error'
);

create type treatment_status as enum (
  'triage',
  'active',
  'paused',
  'discharged',
  'closed'
);

create table professionals (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  crp text,
  email text,
  phone text,
  timezone text not null default 'America/Sao_Paulo',
  default_session_duration_minutes integer not null default 50,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public_profiles (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  slug text not null unique,
  headline text not null,
  bio text not null,
  approaches text[] not null default '{}',
  audiences text[] not null default '{}',
  whatsapp_url text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  full_name text not null,
  preferred_name text,
  email text,
  phone text,
  birth_date date,
  first_contact_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table treatment_episodes (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  status treatment_status not null default 'triage',
  main_complaint text,
  therapeutic_goals text,
  anamnesis_json jsonb not null default '{}'::jsonb,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_duration_minutes integer not null default 50,
  buffer_before_minutes integer not null default 0,
  buffer_after_minutes integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

create table availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete restrict,
  treatment_episode_id uuid references treatment_episodes(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'requested',
  appointment_type text not null default 'online',
  source text not null default 'public_booking',
  google_event_id text,
  meet_url text,
  public_manage_token_hash text,
  cancel_reason text,
  rescheduled_from_id uuid references appointments(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

alter table appointments
  add constraint appointments_no_overlap
  exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status in ('scheduled', 'confirmed'));

create table clinical_notes (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  treatment_episode_id uuid references treatment_episodes(id) on delete set null,
  note_type text not null default 'evolution',
  content text not null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table google_integrations (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  google_account_email text,
  calendar_id text not null default 'primary',
  encrypted_refresh_token text,
  scopes text[] not null default '{}',
  connected_at timestamptz,
  revoked_at timestamptz
);

create table notification_jobs (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp')),
  template_key text not null,
  recipient text not null,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid references professionals(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table professionals enable row level security;
alter table public_profiles enable row level security;
alter table patients enable row level security;
alter table treatment_episodes enable row level security;
alter table availability_rules enable row level security;
alter table availability_exceptions enable row level security;
alter table appointments enable row level security;
alter table clinical_notes enable row level security;
alter table google_integrations enable row level security;
alter table notification_jobs enable row level security;
alter table audit_logs enable row level security;

create policy "professionals manage own profile"
  on professionals for all
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "public can read published profiles"
  on public_profiles for select
  to anon, authenticated
  using (published = true);

create policy "professionals manage own public profiles"
  on public_profiles for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "public can read active availability"
  on availability_rules for select
  to anon, authenticated
  using (
    active = true
    and exists (
      select 1
      from public_profiles
      where public_profiles.professional_id = availability_rules.professional_id
        and public_profiles.published = true
    )
  );

create policy "professionals manage own availability"
  on availability_rules for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own exceptions"
  on availability_exceptions for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own patients"
  on patients for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own treatments"
  on treatment_episodes for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own appointments"
  on appointments for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own notes"
  on clinical_notes for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own google integrations"
  on google_integrations for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals manage own notifications"
  on notification_jobs for all
  to authenticated
  using ((select auth.uid()) = professional_id)
  with check ((select auth.uid()) = professional_id);

create policy "professionals read own audit logs"
  on audit_logs for select
  to authenticated
  using ((select auth.uid()) = professional_id or (select auth.uid()) = actor_user_id);

create index patients_professional_name_idx on patients (professional_id, full_name);
create index appointments_professional_starts_idx on appointments (professional_id, starts_at);
create index appointments_patient_idx on appointments (patient_id);
create index treatment_patient_idx on treatment_episodes (patient_id);
create index clinical_notes_appointment_idx on clinical_notes (appointment_id);
