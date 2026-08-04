create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create table public.registration_nonces (
  nonce uuid primary key,
  nickname_normalized text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.registration_nonces enable row level security;
revoke all on public.registration_nonces from anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  nickname_normalized text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nickname_length check (char_length(nickname_normalized) between 3 and 20),
  constraint nickname_characters check (nickname_normalized ~ '^[a-z0-9_-]+$')
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_mask_id text not null default 'white-dragon',
  neck_enabled boolean not null default false,
  mirror_enabled boolean not null default false,
  preferred_resolution text not null default '720p' check (preferred_resolution = '720p'),
  tracking_smoothing numeric(3,2) not null default 0.65 check (tracking_smoothing between 0 and 1),
  effects_quality text not null default 'auto' check (effects_quality in ('auto', 'low', 'medium', 'high')),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;

grant select on public.profiles to authenticated;
grant select, update on public.user_settings to authenticated;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy "settings_select_own"
on public.user_settings for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "settings_update_own"
on public.user_settings for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger settings_set_updated_at
before update on public.user_settings
for each row execute function private.set_updated_at();

create or replace function private.handle_facecam_user_created()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_nickname text;
  requested_normalized text;
  registration_nonce uuid;
  expected_email text;
begin
  requested_nickname := new.raw_user_meta_data ->> 'nickname';
  requested_normalized := new.raw_user_meta_data ->> 'nickname_normalized';
  registration_nonce := nullif(new.raw_user_meta_data ->> 'registration_nonce', '')::uuid;

  if requested_nickname is null or requested_normalized is null or registration_nonce is null then
    raise exception 'FaceCam registration metadata is incomplete';
  end if;

  expected_email := encode(extensions.digest(convert_to(requested_normalized, 'UTF8'), 'sha256'), 'hex') || '@users.facecam.invalid';
  if new.email is null or lower(new.email) <> expected_email then
    raise exception 'Invalid FaceCam technical identity';
  end if;

  delete from public.registration_nonces
  where nonce = registration_nonce
    and nickname_normalized = requested_normalized
    and expires_at > now();

  if not found then
    raise exception 'Registration nonce is invalid or expired';
  end if;

  insert into public.profiles (id, nickname, nickname_normalized)
  values (new.id, requested_nickname, requested_normalized);

  insert into public.user_settings (user_id)
  values (new.id);

  return new;
end;
$$;

revoke all on function private.handle_facecam_user_created() from public, anon, authenticated;

drop trigger if exists on_facecam_auth_user_created on auth.users;
create trigger on_facecam_auth_user_created
after insert on auth.users
for each row execute function private.handle_facecam_user_created();

create index registration_nonces_expires_at_idx on public.registration_nonces (expires_at);
