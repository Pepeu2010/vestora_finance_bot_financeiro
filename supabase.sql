create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'model')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_device_id_updated_at_idx
  on conversations (device_id, updated_at desc);

create index if not exists messages_conversation_id_created_at_idx
  on messages (conversation_id, created_at asc);

alter table conversations enable row level security;
alter table messages enable row level security;

create policy "conversations_user_isolation" on conversations
  for all using (user_id = auth.uid() or user_id is null);

create policy "messages_user_isolation" on messages
  for all using (
    conversation_id in (
      select id from conversations where user_id = auth.uid() or user_id is null
    )
  );

create policy "conversations_service_role_all" on conversations
  for all using (true) with check (true);

create policy "messages_service_role_all" on messages
  for all using (true) with check (true);
