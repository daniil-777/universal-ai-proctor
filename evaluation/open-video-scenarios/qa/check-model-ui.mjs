import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const here=path.dirname(fileURLToPath(import.meta.url));
const appRoot=path.resolve(here,'../../..');
const require=createRequire(path.join(appRoot,'frontend/package.json'));
const {chromium}=require('playwright-core');
const browser=await chromium.launch({channel:'chrome',headless:true});
const evidence={checked_at:new Date().toISOString(),base_url:process.env.MODEL_UI_URL||'http://127.0.0.1:8102',isolated_fixture:true,provider_requests_forwarded:0,blocked_inference_requests:[],profiles:[]};
try{
  for(const width of [320,768,1440]){
    const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<=768});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.route('**/api/guidance/analyze',route=>{evidence.blocked_inference_requests.push(route.request().url());return route.abort();});
    await page.route('**/api/llm/**',route=>{if(new URL(route.request().url()).pathname==='/api/llm/models')return route.continue();evidence.blocked_inference_requests.push(route.request().url());return route.abort();});
    await page.route('**/api/tts',route=>{evidence.blocked_inference_requests.push(route.request().url());return route.abort();});
    await page.goto(evidence.base_url,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Open workspace',exact:true}).click();
    const mainSelect=page.getByRole('combobox',{name:'AI model',exact:true});
    let chatSelect=mainSelect;
    if(!(await mainSelect.isVisible())){
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      chatSelect=page.getByRole('combobox',{name:'AI model in settings',exact:true});
    }
    assert.match(await chatSelect.innerText(),/GPT-6 Astra/,'Astra must be the fresh-session chat default');
    await chatSelect.click();
    await page.waitForTimeout(350);
    const chatChoices={};
    for(const title of ['GPT-6.1 Sol','GPT-6 Astra','GPT-6 Luna']){
      const option=page.getByRole('option',{name:title,exact:true});
      await option.waitFor({state:'visible'});
      chatChoices[title]=await option.boundingBox();
      assert(chatChoices[title].x>=0&&chatChoices[title].x+chatChoices[title].width<=width+1);
      assert(chatChoices[title].height>=(width<=768?44:32)-.1,'Model option must honor touch sizing');
    }
    await page.getByRole('option',{name:'GPT-6.1 Sol',exact:true}).click();
    assert.match(await chatSelect.innerText(),/GPT-6.1 Sol/);
    if(await page.getByRole('dialog').isVisible())await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByTitle('Guardian settings — model & video processing',{exact:true}).click();
    const popover=page.locator('[data-radix-popper-content-wrapper]').filter({hasText:'Guardian — passive listener'});
    await popover.waitFor({state:'visible'});
    const settingsText=await popover.innerText();
    assert.match(settingsText,/9 frame\(s\) over 8s window/);
    const watch=popover.getByRole('combobox').first();
    assert.match(await watch.innerText(),/GPT-6.1 Sol/,'chat model selection synchronizes Guardian');
    await watch.click();
    await page.waitForTimeout(350);
    const guardianChoices={};
    for(const title of ['GPT-6.1 Sol','GPT-6 Astra','GPT-6 Luna']){const option=page.getByRole('option').filter({hasText:title});await option.waitFor({state:'visible'});guardianChoices[title]=await option.boundingBox();assert(guardianChoices[title].height>=(width<=768?44:32)-.1,'Guardian option must honor touch sizing');}

    await page.screenshot({path:path.join(here,`model-selector-${width}.png`),fullPage:false});
    await page.getByRole('option').filter({hasText:'GPT-6 Luna'}).click();
    assert.match(await watch.innerText(),/GPT-6 Luna/);
    const bounds=await popover.boundingBox();
    assert(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const frameSlider=popover.getByRole('slider').nth(1);
    assert.equal(await frameSlider.getAttribute('aria-valuemax'),'9');
    assert.equal(await frameSlider.getAttribute('aria-valuenow'),'9');
    evidence.profiles.push({width,chat_default:'GPT-6 Astra',chat_selected:'GPT-6.1 Sol',guardian_selected:'GPT-6 Luna',guardian_frames:9,guardian_window_s:8,coarse_pointer:await page.evaluate(()=>matchMedia('(pointer:coarse)').matches),chat_choices:chatChoices,guardian_choices:guardianChoices,popover_bounds:bounds,no_document_overflow:true,page_errors:errors});
    assert.equal(errors.length,0);
    await context.close();
  }
  const delayedContext=await browser.newContext({viewport:{width:320,height:1000},hasTouch:true});
  const delayedPage=await delayedContext.newPage();
  const catalog=await (await delayedPage.request.get(`${evidence.base_url}/api/llm/models`)).json();
  catalog.models.sort((a,b)=>(a.model_id==='gpt-4o'?-1:b.model_id==='gpt-4o'?1:0));
  let releaseCatalog;
  const gate=new Promise(resolve=>{releaseCatalog=resolve;});
  await delayedPage.route('**/api/guidance/analyze',route=>route.abort());
  await delayedPage.route('**/api/llm/ask**',route=>route.abort());
  await delayedPage.route('**/api/tts',route=>route.abort());
  await delayedPage.route('**/api/llm/models',async route=>{await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(catalog)});});
  await delayedPage.goto(evidence.base_url,{waitUntil:'domcontentloaded'});
  await delayedPage.getByRole('button',{name:'Open workspace',exact:true}).click();
  assert.match(await delayedPage.locator('[aria-label="AI model"]').innerText(),/GPT-6 Astra/);
  await delayedPage.getByTitle('Guardian settings — model & video processing',{exact:true}).click();
  const delayedPopover=delayedPage.locator('[data-radix-popper-content-wrapper]').filter({hasText:'Guardian — passive listener'});
  const independentWatch=delayedPopover.getByRole('combobox').first();
  assert.match(await independentWatch.innerText(),/GPT-6 Astra/);
  await independentWatch.click();
  await delayedPage.waitForTimeout(350);
  await delayedPage.getByRole('option').filter({hasText:'GPT-6 Luna'}).click();
  const response=delayedPage.waitForResponse(res=>res.url().endsWith('/api/llm/models')&&res.ok());
  releaseCatalog();
  await response;
  await delayedPage.waitForTimeout(350);
  assert.match(await delayedPage.locator('[aria-label="AI model"]').innerText(),/GPT-6 Astra/,'Stale catalog ordering must preserve Astra chat');
  assert.match(await independentWatch.innerText(),/GPT-6 Luna/,'Late catalog must preserve independently selected Luna Guardian');
  await delayedPage.screenshot({path:path.join(here,'model-selector-late-catalog-320.png'),fullPage:false});
  evidence.late_catalog={width:320,catalog_first:'gpt-4o',chat_preserved:'gpt-6-astra',independent_guardian_preserved:'gpt-6-luna',passed:true};
  await delayedContext.close();
  assert.equal(evidence.provider_requests_forwarded,0,'Selector QA must forward zero inference requests');
  evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);throw error;}
finally{await fs.writeFile(path.join(here,'model-selector-validation.json'),JSON.stringify(evidence,null,2));await browser.close();}
console.log(JSON.stringify(evidence));
