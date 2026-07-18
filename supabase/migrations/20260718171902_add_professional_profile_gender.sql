alter table professionals
  add column if not exists profile_gender text not null default 'feminine'
  check (profile_gender in ('feminine', 'masculine'));
