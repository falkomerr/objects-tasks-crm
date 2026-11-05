create schema if not exists private;
create table public.profiles(id uuid primary key references auth.users(id), name text not null, role text not null check(role in ('manager','executor')));
create table public.objects(id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name))>0), address text not null check(length(trim(address))>0), deleted_at timestamptz);
create table public.tasks(id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title))>0), description text not null default '', object_id uuid not null references public.objects, assignee_id uuid not null references public.profiles, status text not null default 'new' check(status in ('new','in_progress','review','accepted','rework')), author_id uuid not null references public.profiles, created_at timestamptz not null default now(), deleted_at timestamptz);
create table public.task_history(id bigint generated always as identity primary key, task_id uuid not null references public.tasks, actor_id uuid not null references public.profiles, actor_name text not null, from_status text, to_status text not null, comment text, created_at timestamptz not null default now());
create index on public.tasks(assignee_id,object_id);
create index on public.task_history(task_id,id);
create function private.is_manager() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='manager') $$;
create function private.can_read_task(tid uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.tasks t join public.objects o on o.id=t.object_id where t.id=tid and (private.is_manager() or (t.assignee_id=auth.uid() and t.deleted_at is null and o.deleted_at is null))) $$;
alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_history enable row level security;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or private.is_manager());
create policy objects_read on public.objects for select to authenticated using(private.is_manager() or (deleted_at is null and exists(select 1 from public.tasks where object_id=objects.id and assignee_id=auth.uid() and deleted_at is null)));
create policy tasks_read on public.tasks for select to authenticated using(private.can_read_task(id));
create policy history_read on public.task_history for select to authenticated using(private.can_read_task(task_id));
revoke all on public.profiles,public.objects,public.tasks,public.task_history from anon,authenticated;
grant select on public.profiles,public.objects,public.tasks,public.task_history to authenticated;
grant usage on schema private to authenticated;
revoke all on function private.is_manager(),private.can_read_task(uuid) from public,anon;
grant execute on function private.is_manager(),private.can_read_task(uuid) to authenticated;
create function public.save_object(p_id uuid,p_name text,p_address text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.is_manager() then raise exception 'Недостаточно прав'; end if;
 if p_id is null then insert into public.objects(name,address) values(trim(p_name),trim(p_address)) returning id into result;
 else update public.objects set name=trim(p_name),address=trim(p_address) where id=p_id and deleted_at is null returning id into result; end if;
 if result is null then raise exception 'Объект недоступен'; end if; return result;
end $$;
create function public.save_task(p_id uuid,p_title text,p_description text,p_object_id uuid,p_assignee_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.is_manager() then raise exception 'Недостаточно прав'; end if;
 perform 1 from public.objects where id=p_object_id and deleted_at is null for update;
 if not found then raise exception 'Объект недоступен'; end if;
 if not exists(select 1 from public.profiles where id=p_assignee_id and role='executor') then raise exception 'Выберите исполнителя'; end if;
 if p_id is null then
 insert into public.tasks(title,description,object_id,assignee_id,author_id) values(trim(p_title),coalesce(p_description,''),p_object_id,p_assignee_id,auth.uid()) returning id into result;
 insert into public.task_history(task_id,actor_id,actor_name,to_status) select result,id,name,'new' from public.profiles where id=auth.uid();
 else update public.tasks set title=trim(p_title),description=coalesce(p_description,''),object_id=p_object_id,assignee_id=p_assignee_id where id=p_id and deleted_at is null returning id into result; end if;
 if result is null then raise exception 'Задача недоступна'; end if; return result;
end $$;
/** Проверяет права и переход под блокировкой строки, чтобы параллельные запросы не создавали повторную историю. */
create function public.transition_task(p_id uuid,p_status text,p_comment text default null) returns void language plpgsql security definer set search_path='' as $$
declare t public.tasks; manager boolean;
begin
 select * into t from public.tasks where id=p_id for update;
 manager:=private.is_manager();
 if t.id is null or t.deleted_at is not null or not exists(select 1 from public.objects where id=t.object_id and deleted_at is null) or (not manager and t.assignee_id<>auth.uid()) or auth.uid() is null then raise exception 'Задача недоступна'; end if;
 if not ((manager and t.status='review' and p_status in ('accepted','rework')) or (not manager and t.assignee_id=auth.uid() and ((t.status in ('new','rework') and p_status='in_progress') or (t.status='in_progress' and p_status='review')))) then raise exception 'Переход запрещён'; end if;
 if p_status='rework' and nullif(trim(p_comment),'') is null then raise exception 'Укажите причину возврата'; end if;
 update public.tasks set status=p_status where id=p_id;
 insert into public.task_history(task_id,actor_id,actor_name,from_status,to_status,comment) select p_id,id,name,t.status,p_status,nullif(trim(p_comment),'') from public.profiles where id=auth.uid();
end $$;
create function public.archive_record(p_kind text,p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_manager() then raise exception 'Недостаточно прав'; end if;
 if p_kind='object' then
 perform 1 from public.objects where id=p_id and deleted_at is null for update;
 if not found then raise exception 'Объект недоступен'; end if;
 update public.objects set deleted_at=now() where id=p_id;
 update public.tasks set deleted_at=now() where object_id=p_id and deleted_at is null;
 elsif p_kind='task' then update public.tasks set deleted_at=now() where id=p_id and deleted_at is null;
 if not found then raise exception 'Задача недоступна'; end if;
 else raise exception 'Неизвестный тип записи'; end if;
end $$;
revoke execute on function public.save_object(uuid,text,text),public.save_task(uuid,text,text,uuid,uuid),public.transition_task(uuid,text,text),public.archive_record(text,uuid) from public,anon;
grant execute on function public.save_object(uuid,text,text),public.save_task(uuid,text,text,uuid,uuid),public.transition_task(uuid,text,text),public.archive_record(text,uuid) to authenticated;
