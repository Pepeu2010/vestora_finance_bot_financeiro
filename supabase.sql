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

drop policy if exists "conversations_user_isolation" on conversations;
drop policy if exists "messages_user_isolation" on messages;
drop policy if exists "conversations_service_role_all" on conversations;
drop policy if exists "messages_service_role_all" on messages;

create policy "conversations_select_own" on conversations
  for select
  using (user_id = auth.uid());

create policy "conversations_insert_own" on conversations
  for insert
  with check (user_id = auth.uid());

create policy "conversations_update_own" on conversations
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "conversations_delete_own" on conversations
  for delete
  using (user_id = auth.uid());

create policy "messages_select_own" on messages
  for select
  using (
    exists (
      select 1
      from conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

create policy "messages_insert_own" on messages
  for insert
  with check (
    exists (
      select 1
      from conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );

create policy "messages_delete_own" on messages
  for delete
  using (
    exists (
      select 1
      from conversations
      where conversations.id = messages.conversation_id
        and conversations.user_id = auth.uid()
    )
  );
