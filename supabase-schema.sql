-- ============================================================
--  Ragna SMP Bot — Supabase schema  (sorban lefuttatható)
--  Másold be a Supabase SQL Editorba és nyomj Run
-- ============================================================

-- 1. Tierlista
create table if not exists tierlist (
  id         bigint generated always as identity primary key,
  discord_id text not null unique,
  username   text not null,
  mc_name    text,
  tier       text check (tier in ('S','A','B','C','D','F')),
  created_at timestamptz default now()
);

-- 2. Csapatok
create table if not exists teams (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  leader_id  text not null,
  created_at timestamptz default now()
);

create table if not exists team_members (
  id         bigint generated always as identity primary key,
  team_name  text not null,
  player_id  text not null,
  mc_name    text,
  joined_at  timestamptz default now(),
  unique(team_name, player_id),
  foreign key (team_name) references teams(name) on delete cascade
);

create table if not exists team_queue (
  id           bigint generated always as identity primary key,
  team_name    text not null,
  player_id    text not null,
  mc_name      text not null,
  requested_at timestamptz default now(),
  foreign key (team_name) references teams(name) on delete cascade
);

-- 3. Tournament
create table if not exists tournaments (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  created_by    text not null,
  created_at    timestamptz default now(),
  status        text default 'setup',
  current_round int default 1,
  winner_id     text,
  ended_at      timestamptz
);

create table if not exists tournament_players (
  id               bigint generated always as identity primary key,
  tournament_name  text not null,
  player_id        text not null,
  eliminated       boolean default false,
  eliminated_in_round int,
  eliminated_at    timestamptz,
  unique(tournament_name, player_id),
  foreign key (tournament_name) references tournaments(name) on delete cascade
);

create table if not exists tournament_rounds (
  id              bigint generated always as identity primary key,
  tournament_name text not null,
  round_num       int not null,
  status          text default 'pending',
  started_at      timestamptz,
  ended_at        timestamptz,
  unique(tournament_name, round_num),
  foreign key (tournament_name) references tournaments(name) on delete cascade
);

create table if not exists tournament_matches (
  id              bigint generated always as identity primary key,
  tournament_name text not null,
  round_num       int not null,
  player1_id      text not null,
  player2_id      text not null,
  winner_id       text,
  played_at       timestamptz,
  unique(tournament_name, round_num, player1_id, player2_id),
  foreign key (tournament_name) references tournaments(name) on delete cascade
);

-- 4. RLS + Policies
alter table tierlist            enable row level security;
alter table teams               enable row level security;
alter table team_members        enable row level security;
alter table team_queue          enable row level security;
alter table tournaments         enable row level security;
alter table tournament_players  enable row level security;
alter table tournament_rounds   enable row level security;
alter table tournament_matches  enable row level security;

drop policy if exists "anon all" on tierlist;
drop policy if exists "anon all" on teams;
drop policy if exists "anon all" on team_members;
drop policy if exists "anon all" on team_queue;
drop policy if exists "anon all" on tournaments;
drop policy if exists "anon all" on tournament_players;
drop policy if exists "anon all" on tournament_rounds;
drop policy if exists "anon all" on tournament_matches;

create policy "anon all" on tierlist           for all using (true) with check (true);
create policy "anon all" on teams              for all using (true) with check (true);
create policy "anon all" on team_members       for all using (true) with check (true);
create policy "anon all" on team_queue         for all using (true) with check (true);
create policy "anon all" on tournaments        for all using (true) with check (true);
create policy "anon all" on tournament_players for all using (true) with check (true);
create policy "anon all" on tournament_rounds  for all using (true) with check (true);
create policy "anon all" on tournament_matches for all using (true) with check (true);

-- 5. Indexek
create index if not exists idx_tierlist_tier    on tierlist(tier);
create index if not exists idx_team_mem_team   on team_members(team_name);
create index if not exists idx_team_q_team     on team_queue(team_name);
create index if not exists idx_tp_tourn        on tournament_players(tournament_name);
create index if not exists idx_tp_elim         on tournament_players(tournament_name, eliminated);
create index if not exists idx_tr_tourn        on tournament_rounds(tournament_name);
create index if not exists idx_tm_tourn        on tournament_matches(tournament_name);
