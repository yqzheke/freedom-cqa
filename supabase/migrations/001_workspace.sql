create table public.cqa_workspace(id smallint primary key check(id=1),revision bigint not null default 0,body jsonb);
alter table public.cqa_workspace enable row level security;
revoke all on public.cqa_workspace from public,anon,authenticated;
grant select,update on public.cqa_workspace to service_role;
insert into public.cqa_workspace(id) values(1);
insert into storage.buckets(id,name,public) values('cqa-audio','cqa-audio',false) on conflict do nothing;
