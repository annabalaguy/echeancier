-- Échéancier : base de données en ligne (Supabase)
-- À exécuter UNE fois : Supabase > ton projet > SQL Editor > New query > coller > Run.
-- Ré-exécutable sans risque (rien n'est effacé).

-- Une ligne par personne : toutes ses données de l'appli (même format que la sauvegarde .json).
create table if not exists public.echeancier (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data       jsonb  not null,
  rev        bigint not null default 1,          -- numéro de version, +1 à chaque enregistrement
  updated_at timestamptz not null default now()
);

-- Les versions précédentes (filet de sécurité : une mise à jour bogguée de l'appli
-- ne peut pas faire perdre les données, on revient à une version d'avant).
create table if not exists public.echeancier_history (
  id       bigserial primary key,
  user_id  uuid not null references auth.users(id) on delete cascade,
  rev      bigint not null,
  data     jsonb  not null,
  saved_at timestamptz not null default now()
);
create index if not exists echeancier_history_user on public.echeancier_history(user_id, saved_at desc);

-- Chacun ne voit et ne modifie QUE ses propres données.
alter table public.echeancier enable row level security;
alter table public.echeancier_history enable row level security;

drop policy if exists "own row: read"   on public.echeancier;
drop policy if exists "own row: insert" on public.echeancier;
drop policy if exists "own row: update" on public.echeancier;
create policy "own row: read"   on public.echeancier for select using (auth.uid() = user_id);
create policy "own row: insert" on public.echeancier for insert with check (auth.uid() = user_id);
create policy "own row: update" on public.echeancier for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- (pas de suppression depuis l'appli)

drop policy if exists "own history: read" on public.echeancier_history;
create policy "own history: read" on public.echeancier_history for select using (auth.uid() = user_id);
-- (l'historique est écrit uniquement par le déclencheur ci-dessous)

-- À chaque mise à jour : copie de l'ancienne version, on garde les 60 dernières.
create or replace function public.echeancier_keep_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.echeancier_history(user_id, rev, data) values (old.user_id, old.rev, old.data);
  delete from public.echeancier_history
   where user_id = old.user_id
     and id not in (select id from public.echeancier_history where user_id = old.user_id order by saved_at desc, id desc limit 60);
  return new;
end $$;

drop trigger if exists echeancier_history_trg on public.echeancier;
create trigger echeancier_history_trg before update on public.echeancier
  for each row execute function public.echeancier_keep_history();
