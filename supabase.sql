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
