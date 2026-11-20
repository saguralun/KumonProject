import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 };
const rows = [
  { enrollmentId:512,studentName:'นักเรียน หนึ่ง (น้องหนึ่ง)',subjectCode:'ME',currentLevelMasterId:1,currentLevelCode:'C' },
  { enrollmentId:5121,studentName:'นักเรียน สอง',subjectCode:'TRP',currentLevelMasterId:2,currentLevelCode:'A' },
  { enrollmentId:7,studentName:'Akira512 Test (น้องAkira)',subjectCode:'EFL',currentLevelMasterId:3,currentLevelCode:'H' },
  { enrollmentId:8,studentName:'เด็ก แพร (น้องแพร)',subjectCode:'ME',currentLevelMasterId:1,currentLevelCode:'C' }
];
function context(id) {
  return { enrollment:rows.find(row=>row.enrollmentId===id),studentEnrollments:[],defaults:{receiveDate:'2026-11-01',patternCode:'daily10',mainWorksheetNo:101},
    patterns:[{code:'daily10',shortLabel:'10/day',manualCount:1,suffixes:[1],dayOffsets:[0]}],worksheetOptions:{main:[{worksheetNo:101}],zun:[]},history:[] };
}

for(const embedded of [false,true]) test(`Unified WS search uses one field for ID, name and nickname, retains subject filters and supports immediate Enter (${embedded?'desktop':'browser'})`,ui,async()=>{
  const f=await controlFixture('worksheet',async(req,res)=>{
    if(req.path==='/worksheet/search'){
      assert.equal(req.query.mode,!req.query.query || /^\s*#?\s*\d+\s*$/.test(req.query.query)?'all':'name');
      const found=({'512':rows.slice(0,3),'Akira':[rows[2]],'น้องแพร':[rows[3]]})[req.query.query]||[];
      res.json({success:true,rows:req.query.subject==='ALL'?found:found.filter(row=>row.subjectCode===req.query.subject)});return true;
    }
    const match=req.path.match(/enrollments\/(\d+)\/context/);
    if(match){res.json(context(Number(match[1])));return true;}
    return false;
  },{embedded});
  try{
    const {page}=f,search=page.locator('#studentSearch');
    assert.equal(await page.locator('#searchMode,[data-mode]').count(),0);
    assert.equal(await search.getAttribute('placeholder'),'ค้นหา ID / ชื่อ / ชื่อเล่น');
    await page.waitForFunction(()=>document.activeElement?.id==='studentSearch');
    await search.fill('512');await search.press('Enter');
    const selected=async id=>{
      await page.waitForFunction(id=>document.getElementById('studentSearch').value.startsWith(`#${id} `),id);
      await page.waitForFunction(()=>document.activeElement?.matches('[data-ws-input][data-kind=main]'));
    };
    await selected(512);
    await search.click();await search.fill('Akira');
    await page.locator('#searchResults .result-item').first().waitFor();
    assert.match(await page.locator('#searchResults').innerText(),/Akira512.*น้องAkira/);
    await page.locator('#searchResults .result-item').first().click();await selected(7);
    await search.click();await search.fill('น้องแพร');
    await page.locator('#searchResults .result-item').first().waitFor();
    await search.press('Enter');await selected(8);
    await search.click();await search.fill('512');
    await page.waitForFunction(()=>document.querySelectorAll('#searchResults .result-item').length===3);
    assert.deepEqual(await page.locator('#searchResults .result-id').allTextContents(),['#512','#5121','#7']);
    await page.locator('#subjectButtons [data-subject=EFL]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#searchResults .result-item').length===1);
    assert.match(await page.locator('#searchResults').innerText(),/#7.*Akira512/s);
    for(const [width,height] of [[1600,1000],[900,850],[390,844]]){
      await page.setViewportSize({width,height});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      const field=await search.boundingBox();assert.ok(field.width>100);
    }
    await page.screenshot({path:path.join(os.tmpdir(),`kumondb-ws-unified-search-${embedded?'desktop':'browser'}.png`),fullPage:true});
    assert.equal(f.writes().length,0);assert.deepEqual(f.errors,[]);
  }finally{await f.close();}
});

for(const fail of [false,true]) test(`An obsolete unified-search ${fail?'failure':'result'} cannot replace a newer query`,ui,async()=>{
  let release;
  const f=await controlFixture('worksheet',async(req,res)=>{
    if(req.path==='/worksheet/search'){
      if(req.query.query==='old'){
        await new Promise(resolve=>{release=resolve;});
        if(fail)res.status(503).json({success:false,error:'OLD search error'});
        else res.json({success:true,rows:[rows[0]]});
      }else res.json({success:true,rows:req.query.query==='Akira'?[rows[2]]:[]});
      return true;
    }
    return false;
  });
  try{
    const {page}=f,search=page.locator('#studentSearch');
    await page.waitForFunction(()=>document.activeElement?.id==='studentSearch');
    const requested=page.waitForRequest(req=>new URL(req.url()).searchParams.get('query')==='old');
    await search.fill('old');await requested;
    await search.fill('Akira');await page.locator('#searchResults .result-item').waitFor();
    const response=page.waitForResponse(res=>new URL(res.url()).searchParams.get('query')==='old');
    release();await(await response).finished();
    assert.match(await page.locator('#searchResults').innerText(),/Akira512/);
    assert.doesNotMatch(await page.locator('#statusLine').innerText(),/OLD search error/);
    assert.equal(f.writes().length,0);assert.deepEqual(f.errors,[]);
  }finally{release?.();await f.close();}
});
