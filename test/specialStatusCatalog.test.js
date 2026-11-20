import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensureFrghStatus, startSpecialStatusPreparation, waitForSpecialStatusPreparation } from '../services/specialStatusCatalogService.js';

const status = { status_id:42,status_code:'FRGH',status_name:'Existing center label',status_group:2 };
function fixture({ initial, locked, backupError, archive={filename:'fixture.backup',sizeBytes:123} }={}) {
  const events=[];
  const database={async query(){events.push('read');return {rows:initial?[initial]:[]};},async connect(){
    events.push('connect');return {release(){events.push('release');},async query(sql){
      events.push(sql);
      if(sql.startsWith('SELECT'))return {rows:locked?[locked]:[]};
      if(sql.startsWith('INSERT'))return {rows:[{status_id:43}]};
      return {rows:[]};
    }};
  }};
  return {database,events,backup:async()=>{events.push('backup');if(backupError)throw Error('Backup unavailable');return archive;}};
}
test('Existing FRGH retains its ID and label without taking a backup or writing',async()=>{
  const f=fixture({initial:status});
  assert.deepEqual(await ensureFrghStatus(f),{ready:true,added:false,statusId:42});
  assert.deepEqual(f.events,['read']);assert.equal(status.status_name,'Existing center label');
});
test('A missing FRGH is inserted only after a verified backup, with no DDL or existing-row updates',async()=>{
  const f=fixture();const result=await ensureFrghStatus(f);
  assert.equal(result.added,true);assert.equal(result.backupFilename,'fixture.backup');
  assert.ok(f.events.indexOf('backup')<f.events.findIndex(s=>s.startsWith('INSERT')));
  assert.ok(f.events.indexOf('backup')>f.events.findIndex(s=>s.startsWith('LOCK')));
  assert.doesNotMatch(f.events.join('\n'),/\b(?:ALTER|CREATE|DROP|DELETE|UPDATE)\b/);
  assert.deepEqual(f.events.slice(-2),['COMMIT','release']);
});
test('A concurrent preparer which already added FRGH causes no second backup or insert',async()=>{
  const f=fixture({locked:status});assert.equal((await ensureFrghStatus(f)).added,false);
  assert.equal(f.events.includes('backup'),false);assert.ok(!f.events.some(s=>s.startsWith('INSERT')));
});
test('Backup errors or empty archives roll back without adding a status',async()=>{
  for(const options of [{backupError:true},{archive:null},{archive:{filename:'empty.backup',sizeBytes:0}}]){
    const f=fixture(options);await assert.rejects(ensureFrghStatus(f));
    assert.ok(!f.events.some(s=>s.startsWith('INSERT')));assert.deepEqual(f.events.slice(-2),['ROLLBACK','release']);
  }
});
test('An existing FRGH in another status group is preserved and reported as a conflict',async()=>{
  const f=fixture({initial:{...status,status_group:1}});await assert.rejects(ensureFrghStatus(f),{statusCode:409});
  assert.deepEqual(f.events,['read']);
});
test('Failed catalog preparation remains a reported result so startup can keep the application available',async()=>{
  const f=fixture({backupError:true});
  const result=await startSpecialStatusPreparation(f);
  assert.equal(result.ready,false);assert.match(result.error,/FRGH.*Backup unavailable/);
  assert.deepEqual(await waitForSpecialStatusPreparation(),result);
});
