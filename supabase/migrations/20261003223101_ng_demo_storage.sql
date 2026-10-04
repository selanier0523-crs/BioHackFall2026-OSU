-- Public synthetic showcase only. Mock role controls do not provide authentication.
-- Only this named demo workspace is anonymously readable/writable; unrelated tables are untouched.
create table public.ng_demo_records (
  workspace text not null check (workspace = 'BIOHACK-SYNTHETIC-DEMO'),
  id text not null,
  kind text not null check (kind in ('snapshot','patient','device','plan','check','session','alert','assignment','sensor_batch')),
  synthetic boolean not null default true check (synthetic = true),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  revision integer not null default 0 check (revision >= 0),
  primary key (workspace, id)
);
alter table public.ng_demo_records enable row level security;
grant select, insert, update on public.ng_demo_records to anon, authenticated;
create policy synthetic_demo_read on public.ng_demo_records for select to anon, authenticated
  using (workspace = 'BIOHACK-SYNTHETIC-DEMO' and synthetic = true);
create policy synthetic_demo_insert on public.ng_demo_records for insert to anon, authenticated
  with check (workspace = 'BIOHACK-SYNTHETIC-DEMO' and synthetic = true);
create policy synthetic_demo_update on public.ng_demo_records for update to anon, authenticated
  using (workspace = 'BIOHACK-SYNTHETIC-DEMO' and synthetic = true)
  with check (workspace = 'BIOHACK-SYNTHETIC-DEMO' and synthetic = true);
comment on table public.ng_demo_records is 'BioHack public synthetic demonstration. Never store real patient information. No real authentication.';
