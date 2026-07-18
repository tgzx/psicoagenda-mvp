create or replace function public.ensure_my_workspace(
  p_name text default 'Psicólogo',
  p_crp text default '',
  p_email text default null,
  p_phone text default null,
  p_slug text default 'dra-clara-menezes'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_user uuid := (select auth.uid());
  v_profile public_profiles%rowtype;
begin
  if v_user is null then
    raise exception 'login_required' using errcode = '28000';
  end if;

  insert into professionals (id, name, crp, email, phone, timezone, default_session_duration_minutes, active)
  values (v_user, p_name, p_crp, p_email, p_phone, 'America/Sao_Paulo', 50, true)
  on conflict (id) do nothing;

  insert into public_profiles (professional_id, slug, headline, bio, approaches, audiences, whatsapp_url, published)
  select
    v_user,
    p_slug,
    'Atendimento online para adultos com agenda simples',
    'Psicólogo clínico com atendimento online. O paciente agenda sem login e os dados clínicos ficam sob gestão do profissional.',
    array['TCC', 'Ansiedade', 'Transições de carreira'],
    array['Adultos', 'Atendimento online'],
    case when nullif(p_phone, '') is null then null else 'https://wa.me/' || regexp_replace(p_phone, '\D', '', 'g') end,
    true
  where not exists (
    select 1 from public_profiles pp where pp.professional_id = v_user
  )
  on conflict (slug) do nothing;

  select * into v_profile
  from public_profiles pp
  where pp.professional_id = v_user
  order by pp.created_at desc
  limit 1;

  insert into availability_rules (professional_id, weekday, start_time, end_time, slot_duration_minutes, buffer_after_minutes, active)
  select v_user, weekday, start_time::time, end_time::time, 50, 10, true
  from (values (1, '09:00', '17:30'), (2, '08:30', '16:30'), (3, '09:30', '18:00')) as defaults(weekday, start_time, end_time)
  where not exists (
    select 1 from availability_rules ar
    where ar.professional_id = v_user and ar.weekday = defaults.weekday
  );

  return jsonb_build_object(
    'professional', (select to_jsonb(p) from professionals p where p.id = v_user),
    'profile', to_jsonb(v_profile)
  );
end;
$$;

revoke all on function public.ensure_my_workspace(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.ensure_my_workspace(text, text, text, text, text) to authenticated;

update public.public_profiles
set
  bio = 'Psicóloga clínica com atendimento online para ansiedade, transições de carreira e reorganização emocional.',
  approaches = array_replace(approaches, 'Transicoes de carreira', 'Transições de carreira'),
  updated_at = now()
where bio = 'Psicologa clinica com atendimento online para ansiedade, transicoes de carreira e reorganizacao emocional.';
