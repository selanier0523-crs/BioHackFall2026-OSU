import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false}});
const workspace='BIOHACK-SYNTHETIC-DEMO',id='VERIFICATION-SYNTHETIC-SESSION';
const record={workspace,id,kind:'session',synthetic:true,revision:0,payload:{synthetic:true,fixture:'VERIFICATION',volume:1,missing:1,note:'Idempotent storage verification only, not a patient session.'}};
for(let i=0;i<2;i++){const {error}=await client.from('ng_demo_records').upsert(record,{onConflict:'workspace,id'});assert.equal(error,null);}
const {data,error}=await client.from('ng_demo_records').select('id,payload').eq('workspace',workspace).eq('id',id);assert.equal(error,null);assert.equal(data.length,1);assert.equal(data[0].payload.missing,1);
const rejected=await client.from('ng_demo_records').insert({...record,id:'SHOULD-NOT-EXIST',workspace:'UNRELATED'});assert.ok(rejected.error,'Other workspaces must be rejected.');
const syntheticRejected=await client.from('ng_demo_records').insert({...record,id:'SHOULD-NOT-EXIST',synthetic:false});assert.ok(syntheticRejected.error,'Non-synthetic rows must be rejected.');
const invisible=await client.from('ng_demo_records').select('id').eq('workspace','UNRELATED');assert.deepEqual(invisible.data,[]);
console.log('PASS: publishable-key access, idempotent session upsert, missing flag, workspace isolation and synthetic-only constraints.');
