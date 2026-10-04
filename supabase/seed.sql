insert into public.ng_demo_records(workspace,id,kind,synthetic,payload) values
('BIOHACK-SYNTHETIC-DEMO','patient','patient',true,'{"id":"DEMO-PATIENT-01","name":"Demo Patient","synthetic":true}'),
('BIOHACK-SYNTHETIC-DEMO','device','device',true,'{"id":"DEMO-DEVICE-01","synthetic":true}')
on conflict (workspace,id) do nothing;
-- CSV care plans and assigned resources initialize the shared snapshot on first app load.
