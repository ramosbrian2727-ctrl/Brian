-- GASTOS DE CASA - SUPABASE SCHEMA
-- Pegá todo este archivo en Supabase → SQL Editor → New query → Run.
-- Después configurá Authentication → Providers → Email habilitado.

create extension if not exists "pgcrypto";

-- Limpieza opcional si estás probando desde cero.
-- CUIDADO: esto borra datos si ya tenías la app en uso.
-- drop table if exists public.expense_splits cascade;
-- drop table if exists public.expenses cascade;
-- drop table if exists public.contributions cascade;
-- drop table if exists public.people cascade;
-- drop table if exists public.categories cascade;
-- drop table if exists public.group_members cascade;
-- drop table if exists public.groups cascade;
-- drop table if exists public.profiles cascade;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  created_at timestamptz default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','editor','viewer')),
  created_at timestamptz default now(),
  unique(group_id, user_id)
);

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  date date not null,
  description text not null,
  category_id uuid references public.categories(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  payer_person_id uuid references public.people(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  person_id uuid not null references public.people(id) on delete cascade,
  created_at timestamptz default now(),
  unique(expense_id, person_id)
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  date date not null,
  person_id uuid references public.people(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  method text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- Perfil automático cuando alguien se registra.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Funciones de seguridad.
create or replace function public.is_group_member(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = auth.uid()
  );
$$;

create or replace function public.is_group_admin(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = auth.uid() and gm.role = 'admin'
  );
$$;

create or replace function public.can_group_write(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid and gm.user_id = auth.uid() and gm.role in ('admin','editor')
  );
$$;

create or replace function public.expense_group_id(expid uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select e.group_id from public.expenses e where e.id = expid;
$$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.people enable row level security;
alter table public.categories enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.contributions enable row level security;

-- Profiles
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check (id = auth.uid());

-- Groups
drop policy if exists "groups_select_member" on public.groups;
create policy "groups_select_member"
on public.groups for select
to authenticated
using (public.is_group_member(id));

drop policy if exists "groups_insert_owner" on public.groups;
create policy "groups_insert_owner"
on public.groups for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "groups_update_admin" on public.groups;
create policy "groups_update_admin"
on public.groups for update
to authenticated
using (public.is_group_admin(id))
with check (public.is_group_admin(id));

drop policy if exists "groups_delete_admin" on public.groups;
create policy "groups_delete_admin"
on public.groups for delete
to authenticated
using (public.is_group_admin(id));

-- Group members
drop policy if exists "group_members_select_member" on public.group_members;
create policy "group_members_select_member"
on public.group_members for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "group_members_insert_self_or_admin" on public.group_members;
create policy "group_members_insert_self_or_admin"
on public.group_members for insert
to authenticated
with check (
  (user_id = auth.uid()) or public.is_group_admin(group_id)
);

drop policy if exists "group_members_update_admin" on public.group_members;
create policy "group_members_update_admin"
on public.group_members for update
to authenticated
using (public.is_group_admin(group_id))
with check (public.is_group_admin(group_id));

drop policy if exists "group_members_delete_admin" on public.group_members;
create policy "group_members_delete_admin"
on public.group_members for delete
to authenticated
using (public.is_group_admin(group_id));

-- People
drop policy if exists "people_select_member" on public.people;
create policy "people_select_member"
on public.people for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "people_insert_write" on public.people;
create policy "people_insert_write"
on public.people for insert
to authenticated
with check (public.can_group_write(group_id));

drop policy if exists "people_update_write" on public.people;
create policy "people_update_write"
on public.people for update
to authenticated
using (public.can_group_write(group_id))
with check (public.can_group_write(group_id));

drop policy if exists "people_delete_admin" on public.people;
create policy "people_delete_admin"
on public.people for delete
to authenticated
using (public.is_group_admin(group_id));

-- Categories
drop policy if exists "categories_select_member" on public.categories;
create policy "categories_select_member"
on public.categories for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "categories_insert_write" on public.categories;
create policy "categories_insert_write"
on public.categories for insert
to authenticated
with check (public.can_group_write(group_id));

drop policy if exists "categories_update_write" on public.categories;
create policy "categories_update_write"
on public.categories for update
to authenticated
using (public.can_group_write(group_id))
with check (public.can_group_write(group_id));

drop policy if exists "categories_delete_admin" on public.categories;
create policy "categories_delete_admin"
on public.categories for delete
to authenticated
using (public.is_group_admin(group_id));

-- Expenses
drop policy if exists "expenses_select_member" on public.expenses;
create policy "expenses_select_member"
on public.expenses for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "expenses_insert_write" on public.expenses;
create policy "expenses_insert_write"
on public.expenses for insert
to authenticated
with check (public.can_group_write(group_id) and created_by = auth.uid());

drop policy if exists "expenses_update_owner_or_admin" on public.expenses;
create policy "expenses_update_owner_or_admin"
on public.expenses for update
to authenticated
using (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()))
with check (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()));

drop policy if exists "expenses_delete_owner_or_admin" on public.expenses;
create policy "expenses_delete_owner_or_admin"
on public.expenses for delete
to authenticated
using (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()));

-- Expense splits
drop policy if exists "splits_select_member" on public.expense_splits;
create policy "splits_select_member"
on public.expense_splits for select
to authenticated
using (public.is_group_member(public.expense_group_id(expense_id)));

drop policy if exists "splits_insert_write" on public.expense_splits;
create policy "splits_insert_write"
on public.expense_splits for insert
to authenticated
with check (public.can_group_write(public.expense_group_id(expense_id)));

drop policy if exists "splits_delete_write" on public.expense_splits;
create policy "splits_delete_write"
on public.expense_splits for delete
to authenticated
using (public.can_group_write(public.expense_group_id(expense_id)));

-- Contributions
drop policy if exists "contributions_select_member" on public.contributions;
create policy "contributions_select_member"
on public.contributions for select
to authenticated
using (public.is_group_member(group_id));

drop policy if exists "contributions_insert_write" on public.contributions;
create policy "contributions_insert_write"
on public.contributions for insert
to authenticated
with check (public.can_group_write(group_id) and created_by = auth.uid());

drop policy if exists "contributions_update_owner_or_admin" on public.contributions;
create policy "contributions_update_owner_or_admin"
on public.contributions for update
to authenticated
using (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()))
with check (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()));

drop policy if exists "contributions_delete_owner_or_admin" on public.contributions;
create policy "contributions_delete_owner_or_admin"
on public.contributions for delete
to authenticated
using (public.is_group_admin(group_id) or (public.can_group_write(group_id) and created_by = auth.uid()));
-- GASTOS DE CASA v2 - ACTUALIZACIÓN SEGURA
-- No borra los datos existentes.
-- Pegá todo en Supabase > SQL Editor > New query > Run.

create extension if not exists "pgcrypto";

-- Código de invitación único para cada grupo.
alter table public.groups add column if not exists invite_code text;

update public.groups
set invite_code = 'CASA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6))
where invite_code is null or trim(invite_code) = '';

alter table public.groups alter column invite_code set not null;
create unique index if not exists groups_invite_code_key on public.groups(invite_code);

-- Incorporamos el rol colaborador sin borrar membresías existentes.
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members
  add constraint group_members_role_check
  check (role in ('admin','editor','collaborator','viewer'));

-- Lectura del grupo: miembro o propietario durante la creación inicial.
drop policy if exists "groups_select_member" on public.groups;
drop policy if exists "groups_select_member_or_owner" on public.groups;
create policy "groups_select_member_or_owner"
on public.groups for select
to authenticated
using (owner_id = auth.uid() or public.is_group_member(id));

-- Permisos separados: colaborador puede crear movimientos, pero no administrar.
create or replace function public.can_group_create(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid
      and gm.user_id = auth.uid()
      and gm.role in ('admin','editor','collaborator')
  );
$$;

create or replace function public.can_group_write(gid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members gm
    where gm.group_id = gid
      and gm.user_id = auth.uid()
      and gm.role in ('admin','editor')
  );
$$;

-- Unirse mediante código. Se ingresa como colaborador y el administrador puede cambiar el rol.
create or replace function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select id into v_group_id
  from public.groups
  where upper(invite_code) = upper(trim(p_code));

  if v_group_id is null then
    raise exception 'Código de invitación incorrecto.';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'collaborator')
  on conflict (group_id, user_id) do nothing;

  return v_group_id;
end;
$$;

grant execute on function public.join_group_by_code(text) to authenticated;

-- Gastos: colaborador puede crear. Solo admin/editor pueden modificar o borrar según autoría.
drop policy if exists "expenses_insert_write" on public.expenses;
create policy "expenses_insert_create"
on public.expenses for insert
to authenticated
with check (public.can_group_create(group_id) and created_by = auth.uid());

-- Divisiones: colaborador puede crear divisiones del gasto que acaba de cargar.
drop policy if exists "splits_insert_write" on public.expense_splits;
create policy "splits_insert_create"
on public.expense_splits for insert
to authenticated
with check (public.can_group_create(public.expense_group_id(expense_id)));

-- Aportes: colaborador puede crear.
drop policy if exists "contributions_insert_write" on public.contributions;
create policy "contributions_insert_create"
on public.contributions for insert
to authenticated
with check (public.can_group_create(group_id) and created_by = auth.uid());
