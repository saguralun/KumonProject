import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';

const pages = ['index','worksheet','student-manager','payment','report','ksis','progress-chart','statistics','stock','stock-receive','stock-cut','forecast','opening-schedule','users','backup','migration'];
async function fixture() {
    const app = express();
    app.get('/migration.html', (_req,res) => res.sendFile(path.resolve('migration/migrationCenter.html')));
    app.use(express.static('public'));
    const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    const browser = await chromium.launch({ channel:'chrome',headless:true,chromiumSandbox:true });
    return { server,browser,origin:`http://127.0.0.1:${server.address().port}`,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));} };
}
async function isolate(page, role='admin',permissions=['*']) {
    await page.route('https://fonts.**', route=>route.abort());
    await page.route('**/js/**', route=> {
        const pathname=new URL(route.request().url()).pathname;
        return /\/(authClient|appMenu|navFlyout)\.js$/.test(pathname) ? route.continue() : route.fulfill({contentType:'application/javascript',body:''});
    });
    await page.route('**/api/**',route=> {
        assert.equal(route.request().method(),'GET','Opening or closing menus must not mutate data');
        const data=new URL(route.request().url()).pathname==='/api/auth/me'
            ? {user:{role,displayName:'Navigation Fixture'},permissions}
            : {success:true,checked:false,rows:[],tables:[],columns:[],modules:[]};
        return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    });
}

test('Every workspace starts with the new layout before JavaScript, without flashing the retired sidebar',{
    skip:process.env.TEST_BROWSER_UI!=='1',timeout:60000
},async()=>{
    const testApp=await fixture();
    try {
        const context=await testApp.browser.newContext({javaScriptEnabled:false});
        const page=await context.newPage(); await isolate(page);
        for(const size of [{width:1440,height:900},{width:390,height:844}]) {
            await page.setViewportSize(size);
            for(const name of pages) {
                await page.goto(`${testApp.origin}/${name}.html`);
                const panel=page.locator('.app-menu-panel'),button=page.locator('.app-menu-toggle');
                assert.equal(await panel.count(),1,name);
                assert.equal(await panel.isVisible(),false,`${name}: sidebar hidden before initialization`);
                assert.equal(await panel.evaluate(element=>element.inert),true,name);
                assert.equal(await button.count(),1,name);
                assert.equal(await button.isVisible(),true,`${name}: stable menu button before initialization`);
                assert.equal(await page.locator('.app-menu-heading').count(),0,'No menu script has run');
                const workspace=page.locator('main.app-menu-layout > section, .migration-shell > .migration-workspace');
                const box=await workspace.boundingBox();
                assert.ok(box.x<24&&box.width>=size.width-40,`${name}: no initial sidebar column`);
                if(name==='payment'&&size.width===1440)await page.screenshot({path:path.join(os.tmpdir(),'kumondb-menu-first-paint.png')});
            }
        }
        await context.close();
    } finally {await testApp.close();}
});

test('Every workspace has one header menu, no edge handle, full-width content and accessible close controls on desktop and mobile',{
    skip:process.env.TEST_BROWSER_UI!=='1',timeout:90000
},async()=>{
    const testApp=await fixture();
    try {
        const page=await testApp.browser.newPage(); await isolate(page);
        await page.addInitScript(()=>localStorage.setItem('appSidebarCollapsed','false'));
        for(const size of [{width:1440,height:900},{width:390,height:844}]) {
            await page.setViewportSize(size);
            for(const name of pages) {
                await page.goto(`${testApp.origin}/${name}.html`);
                const button=page.locator('.app-menu-toggle'), panel=page.locator('.app-menu-panel');
                await button.waitFor();
                assert.equal(await button.count(),1,name); assert.equal(await page.locator('.rail-collapse-toggle').count(),0,name);
                assert.equal(await panel.isVisible(),false,name);
                assert.equal(await panel.locator('.filter-panel,.student-list,.subject-buttons,.subject-tabs,.side-header,.rail-title,.sidebar-scroll,.sidebar-note').count(),0,`${name}: navigation contains no page content`);
                assert.equal(await panel.evaluate(element=>[...element.children].every(child=>child.matches('nav,.app-menu-heading,.auth-bar'))),true,`${name}: only navigation and account controls`);
                assert.equal(await button.getAttribute('aria-expanded'),'false',name);
                const rect=await button.boundingBox(); assert.ok(rect.width>=40 && rect.height>=40,`${name}: touch target`);
                assert.ok(rect.x<50 && rect.y<60,`${name}: consistent header position ${JSON.stringify(rect)}`);
                assert.equal(await button.locator('img').evaluate(image=>image.complete && image.naturalWidth>0),true,name);
                const workspace=page.locator('main.app-menu-layout > section, .migration-shell > .migration-workspace');
                assert.ok((await workspace.boundingBox()).x<24,`${name}: content must not reserve a sidebar column`);
                await button.click();
                assert.equal(await panel.isVisible(),true,name);
                assert.equal(await workspace.evaluate(element=>element.inert),true,name);
                assert.equal(await button.getAttribute('aria-expanded'),'true',name);
                const bounds=await panel.boundingBox(); assert.ok(bounds.x>=0 && bounds.x+bounds.width<=size.width,name);
                const group=panel.locator('.nav-flyout-trigger').filter({hasText:'จัดการ'});
                const groupBefore=await group.boundingBox();
                await group.focus(); await page.keyboard.press('Enter');
                assert.equal(await group.getAttribute('aria-expanded'),'true',name);
                assert.equal(await panel.locator('[href="/student-manager.html"]').last().isVisible(),true,name);
                const submenu=panel.locator('.nav-flyout-open > .nav-flyout-menu');
                const floating=await submenu.boundingBox();
                assert.equal(await submenu.evaluate(element=>getComputedStyle(element).position),'fixed',name);
                assert.ok(floating.x>=12 && floating.x+floating.width<=size.width-11,`${name}: flyout stays within viewport`);
                assert.ok(floating.y>=12 && floating.y+floating.height<=size.height-11,`${name}: flyout vertical bounds`);
                if(size.width>=600) assert.ok(floating.x>=bounds.x+bounds.width+7,`${name}: submenu flies out beside panel`);
                assert.deepEqual(await group.boundingBox(),groupBefore,`${name}: submenu does not reflow navigation`);
                if(name==='student-manager') await page.locator('#studentList').evaluate(element=>{element.innerHTML='<button type="button" class="student-item" data-student-id="123"><div class="student-item-name">นักเรียนตัวอย่าง</div></button>';});
                const contrast=await panel.evaluate(element=>{
                    const canvas=document.createElement('canvas'); canvas.width=canvas.height=1; const context=canvas.getContext('2d');
                    const luminance=color=>{context.fillStyle='#fff';context.fillRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const channels=[...context.getImageData(0,0,1,1).data].slice(0,3).map(value=>{const c=value/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
                    return [...element.querySelectorAll('.subject-button,.subject-tab,.grade-filter-tab,.student-item,.grade-filter-header,.progress-legend-title,.stats-legend-title,.stock-legend-title,.legend-row,.stock-legend-row,.auth-logout')].filter(control=>control.getClientRects().length&&!control.disabled).map(control=>{const css=getComputedStyle(control),fore=luminance(css.color),back=luminance(css.backgroundColor);return {control:control.className,ratio:(Math.max(fore,back)+.05)/(Math.min(fore,back)+.05)};});
                });
                assert.ok(contrast.every(control=>control.ratio>=4.5),`${name}: contrast ${JSON.stringify(contrast)}`);
                assert.equal(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1),true,`${name}: menu overflow`);
                await panel.locator('.app-menu-close').focus(); await page.keyboard.press('Shift+Tab');
                assert.equal(await page.evaluate(()=>document.querySelector('.app-menu-panel').contains(document.activeElement)),true,name);
                await page.keyboard.press('Escape');
                assert.equal(await panel.isVisible(),false,name);
                assert.equal(await workspace.evaluate(element=>element.inert),false,name);
                assert.equal(await button.evaluate(element=>element===document.activeElement),true,name);
                await button.click();
                await page.locator('.app-menu-backdrop').click({position:{x:size.width-10,y:100}});
                assert.equal(await panel.isVisible(),false,name);
                if(name==='worksheet' || name==='payment' || name==='report') {
                    await page.screenshot({path:path.join(os.tmpdir(),`kumondb-menu-${name}-${size.width}-closed.png`)});
                    await button.click(); await group.focus(); await page.keyboard.press('Enter');
                    await page.screenshot({path:path.join(os.tmpdir(),`kumondb-menu-${name}-${size.width}-open.png`)});
                    await page.keyboard.press('Escape');
                }
            }
        }
        await page.goto(`${testApp.origin}/login.html`);
        assert.equal(await page.locator('.app-menu-toggle').count(),0);
    } finally {await testApp.close();}
});

test('Flyouts support pointer gap crossing, one open group, keyboard return and viewport resizing',{
    skip:process.env.TEST_BROWSER_UI!=='1',timeout:20000
},async()=>{
    const testApp=await fixture();
    try {
        const page=await testApp.browser.newPage({viewport:{width:1440,height:900}}); await isolate(page);
        await page.goto(`${testApp.origin}/payment.html`); await page.locator('.app-menu-toggle').click();
        const group=page.locator('.nav-flyout').filter({has:page.locator('.nav-flyout-trigger', {hasText:'จัดการ'})});
        const trigger=group.locator('.nav-flyout-trigger'), submenu=group.locator('.nav-flyout-menu');
        await trigger.hover();
        const menuBox=await submenu.boundingBox(), anchor=await trigger.boundingBox();
        await page.mouse.move(anchor.x+anchor.width+4,anchor.y+anchor.height/2);
        await page.mouse.move(menuBox.x+20,menuBox.y+20);
        await page.waitForTimeout(250);
        assert.equal(await submenu.isVisible(),true,'Crossing the gap keeps submenu open');
        assert.equal(await submenu.evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.x+20,rect.y+20));}),true,'Flyout is not clipped by panel or backdrop');
        await page.locator('.nav-flyout-trigger').filter({hasText:'คลัง'}).hover();
        assert.equal(await page.locator('.nav-flyout-open').count(),1);
        await trigger.focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await submenu.evaluate(element=>element.contains(document.activeElement)),true);
        await page.keyboard.press('ArrowLeft');
        assert.equal(await submenu.isVisible(),false);
        assert.equal(await trigger.evaluate(element=>element===document.activeElement),true);
        await page.keyboard.press('ArrowRight');
        await page.setViewportSize({width:390,height:300});
        await page.waitForFunction(()=>{const rect=document.querySelector('.nav-flyout-open .nav-flyout-menu')?.getBoundingClientRect();return rect&&rect.right<=innerWidth-11&&rect.bottom<=innerHeight-11;});
        assert.equal(await submenu.locator('a[href]').first().evaluate(element=>{const rect=element.getBoundingClientRect();return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));}),true,'Sticky panel heading must not cover a floating submenu');
        await page.screenshot({path:path.join(os.tmpdir(),'kumondb-menu-flyout-small.png')});
    } finally {await testApp.close();}
});

test('Page tools remain visible, readable and operable without opening navigation',{
    skip:process.env.TEST_BROWSER_UI!=='1',timeout:60000
},async()=>{
    const testApp=await fixture();
    const controls={worksheet:['subjectButtons'], 'student-manager':['studentList'],payment:['billingMonth','billingYear'],report:['reportMonth','reportYear','generateButton','levelSummaryButton'],ksis:['reportMonth','reportYear'],forecast:['forecastDays','forecastButton','subjectTabs'],stock:['subjectTabs','refreshStockButton'],'stock-receive':['typeFilter','statusFilter','doSearch'],'stock-cut':['typeButtons'],'progress-chart':['subjectTabs','gradeFilter','combinedLegend'],statistics:['legendOut','legendIn','legendCurrent']};
    try {
        const page=await testApp.browser.newPage(); await isolate(page);
        for(const size of [{width:1920,height:1080},{width:1440,height:900},{width:1366,height:768},{width:1024,height:768},{width:768,height:1024},{width:390,height:844}]) {
            await page.setViewportSize(size);
            for(const [name,ids] of Object.entries(controls)) {
                if([1920,1366,1024].includes(size.width)&&name!=='student-manager') continue;
                await page.goto(`${testApp.origin}/${name}.html`); await page.locator('.app-menu-toggle').waitFor();
                await page.evaluate(()=>{
                    for(const id of ['subjectTabs','typeButtons']) {
                        const element=document.getElementById(id);
                        if(element&&!element.children.length) element.innerHTML=['ME','EFL','TRP'].map(code=>`<button class="subject-tab" type="button">${code}</button>`).join('');
                    }
                    const list=document.getElementById('studentList');
                    if(list) list.innerHTML=Array.from({length:25},(_,i)=>`<button class="student-item" type="button" data-student-id="${i}"><div class="student-item-name">นักเรียน ตัวอย่างทดสอบนามสกุลยาว ${i}</div></button>`).join('');
                    const grades=document.getElementById('gradeFilter');
                    if(grades) grades.innerHTML=['PK1','PK2','PK3','1','2','3','4','5','6','7','8','9'].map(grade=>`<button class="grade-filter-tab" type="button">${grade}</button>`).join('');
                    for(const id of ['combinedLegend','legendOut','legendIn','legendCurrent']) {
                        const element=document.getElementById(id);
                        if(element) element.innerHTML=['สถานะตัวอย่าง','สถานะอื่น'].map(text=>`<div class="legend-row"><span class="legend-dot"></span>${text}</div>`).join('');
                    }
                    document.querySelectorAll('.workspace-toolbar select').forEach(element=>{if(!element.options.length) element.add(new Option('ตุลาคม','10'));});
                });
                for(const id of ids) {
                    const control=page.locator(`#${id}`); assert.equal(await control.count(),1,`${name}: unique ${id}`);
                    assert.equal(await control.isVisible(),true,`${name}: ${id} visible with menu closed`);
                    assert.equal(await control.evaluate(element=>!element.closest('aside')&&!element.closest('[inert]')),true,`${name}: ${id} belongs to workspace`);
                    const rect=await control.boundingBox(); assert.ok(rect.x>=0&&rect.x+rect.width<=size.width+1,`${name}: ${id} horizontal bounds at ${size.width}`);
                }
                if(name==='student-manager') {
                    const directory=await page.locator('.student-directory').boundingBox();
                    const profile=await page.locator('.student-workspace > .form-grid').boundingBox();
                    const list=page.locator('#studentList'),items=list.locator('.student-item');
                    const first=await items.nth(0).boundingBox(),second=await items.nth(1).boundingBox();
                    assert.equal(first.x,second.x,'Student results use one vertical column');
                    assert.ok(second.y>=first.y+first.height,'Student rows never overlap');
                    assert.equal(await list.evaluate(element=>element.scrollHeight>element.clientHeight),true,'Directory scrolls independently');
                    assert.equal(await items.evaluateAll(elements=>elements.every(element=>element.scrollWidth<=element.clientWidth+1)),true,'Long student names fit their rows');
                    if(size.width>=821) {
                        assert.ok(directory.x+directory.width<=profile.x,'Student directory is left of the profile');
                        const history=await page.locator('.student-workspace > .history-panel').boundingBox();
                        assert.ok(history.x>=profile.x&&history.y>=profile.y+profile.height,'History remains below profile, beside directory');
                        assert.ok(directory.y+directory.height<=size.height+1&&history.y+history.height<=size.height+1,'Desktop panels fit the viewport');
                    } else assert.ok(directory.y+directory.height<=profile.y,'Small screens stack the directory above the profile');
                    await list.evaluate(element=>{element.scrollTop=element.scrollHeight;});
                    await items.last().click();
                }
                const clickable=page.locator('.workspace-toolbar button:not(:disabled),.workspace-subjects button,.workspace-student-list button').first();
                if(await clickable.count()) await clickable.click();
                const badContrast=await page.evaluate(()=>{
                    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
                    const lum=color=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const c=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
                    return [...document.querySelectorAll('.workspace-toolbar .subject-tab,.workspace-toolbar .grade-filter-tab,.workspace-subjects button,.workspace-student-list button,.workspace-legend .legend-row,.workspace-stats-legend .legend-row')].filter(e=>{const css=getComputedStyle(e),a=lum(css.color),b=lum(css.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5;}).map(e=>e.className);
                });
                assert.deepEqual(badContrast,[],`${name}: readable workspace controls`);
                if(['student-manager','report','worksheet','progress-chart','statistics','stock','ksis'].includes(name)) await page.screenshot({path:path.join(os.tmpdir(),`kumondb-workspace-${name}-${size.width}.png`)});
                assert.equal(await page.locator('.app-menu-toggle').getAttribute('aria-expanded'),'false');
            }
        }
    } finally {await testApp.close();}
});

test('Menu permissions are unchanged and an open menu never follows navigation to the next workspace',{
    skip:process.env.TEST_BROWSER_UI!=='1',timeout:20000
},async()=>{
    const testApp=await fixture();
    try {
        const page=await testApp.browser.newPage(); await isolate(page,'staff',['page:payment']);
        await page.goto(`${testApp.origin}/worksheet.html`); await page.locator('.app-menu-toggle').click();
        await page.locator('.nav-flyout-trigger').filter({hasText:'จัดการ'}).click();
        assert.equal(await page.locator('.app-menu-panel [data-admin-only]').evaluateAll(elements=>elements.every(element=>getComputedStyle(element).display==='none')),true);
        assert.equal(await page.locator('.app-menu-panel [data-ksis-link]').isVisible(),false);
        await page.locator('.app-menu-panel a[href="/payment.html"]').click(); await page.waitForURL('**/payment.html');
        assert.equal(await page.locator('.app-menu-toggle').getAttribute('aria-expanded'),'false');
        assert.equal(await page.locator('.app-menu-panel').isVisible(),false);
        await page.locator('.app-menu-toggle').click(); await page.locator('.app-menu-close').click();
        assert.equal(await page.locator('.app-menu-panel').isVisible(),false);
    } finally {await testApp.close();}
});
