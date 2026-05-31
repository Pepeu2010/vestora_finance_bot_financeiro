create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

alter table conversations
  add column if not exists user_id uuid references app_users(id) on delete cascade;

alter table conversations
  alter column device_id drop not null;

create index if not exists conversations_user_id_updated_at_idx
  on conversations (user_id, updated_at desc);

-- Opcional: se quiser apagar conversas antigas anonimas depois de migrar para login:
-- delete from conversations where user_id is null;
