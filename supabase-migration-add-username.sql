-- Migração: adicionar coluna username na tabela app_users
-- Execute este SQL no Supabase Dashboard > SQL Editor

alter table app_users
  add column if not exists username text;

create unique index if not exists app_users_username_idx
  on app_users (username)
  where username is not null and username != '';