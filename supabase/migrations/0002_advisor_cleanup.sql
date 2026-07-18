create schema if not exists extensions;

alter extension btree_gist set schema extensions;

drop policy if exists "public can read published profiles" on public_profiles;
create policy "anon can read published profiles"
  on public_profiles for select
  to anon
  using (published = true);

drop policy if exists "public can read active availability" on availability_rules;
create policy "anon can read active availability"
  on availability_rules for select
  to anon
  using (
    active = true
    and exists (
      select 1
      from public_profiles
      where public_profiles.professional_id = availability_rules.professional_id
        and public_profiles.published = true
    )
  );

create index public_profiles_professional_idx on public_profiles (professional_id);
create index treatment_professional_idx on treatment_episodes (professional_id);
create index availability_rules_professional_idx on availability_rules (professional_id);
create index availability_exceptions_professional_idx on availability_exceptions (professional_id);
create index appointments_treatment_idx on appointments (treatment_episode_id);
create index appointments_rescheduled_from_idx on appointments (rescheduled_from_id);
create index clinical_notes_professional_idx on clinical_notes (professional_id);
create index clinical_notes_treatment_idx on clinical_notes (treatment_episode_id);
create index google_integrations_professional_idx on google_integrations (professional_id);
create index notification_jobs_professional_idx on notification_jobs (professional_id);
create index notification_jobs_appointment_idx on notification_jobs (appointment_id);
create index audit_logs_professional_idx on audit_logs (professional_id);
create index audit_logs_actor_user_idx on audit_logs (actor_user_id);
