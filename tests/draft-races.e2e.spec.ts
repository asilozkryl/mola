import { expect, test, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Bootstrap } from '../shared/types';

const origin='http://127.0.0.1:5174';
const input=(page:Page)=>page.getByRole('textbox',{name:'#genel kanalına mesaj yaz',exact:true});
async function setup(page:Page) {
  const email=`draft-race-${randomUUID()}@example.invalid`, password='draft-race-test-password';
  const response=await page.request.post('/api/auth/register',{headers:{Origin:origin},data:{name:'Taslak Yarışı',email,password,workspaceName:'Taslak Ekibi'}});
  expect(response.status()).toBe(200);
  const account=await response.json() as Bootstrap;
  await page.goto('/');await expect(input(page)).toBeVisible();
  const channel=account.channels.find(channel=>channel.name==='genel')!;
  return{account,channel,email,password,path:`/api/channels/${channel.id}/draft`};
}

test('a conflict discovered during the send flush prevents the message POST',async({page,browser})=>{
  const {channel,email,password,path}=await setup(page);
  const second=await browser.newContext();
  let blocked:Route|undefined, posts=0;
  try {
    expect((await second.request.post(origin+'/api/auth/login',{headers:{Origin:origin},data:{email,password}})).status()).toBe(200);
    await page.route(`**${path}`,route=>{if(route.request().method()==='PUT'){blocked=route;return;}return route.continue();});
    page.on('request',request=>{if(request.url().endsWith(`/channels/${channel.id}/messages`)&&request.method()==='POST')posts++;});
    await input(page).fill('Bu cihazdaki taslak');
    await page.getByRole('button',{name:'Mesaj gönder',exact:true}).click();
    await expect.poll(()=>Boolean(blocked)).toBe(true);
    const remote=await(await second.request.get(origin+path)).json();
    expect((await second.request.put(origin+path,{headers:{Origin:origin},data:{content:'Diğer cihazdaki taslak',revision:remote.revision}})).status()).toBe(200);
    await blocked!.continue();blocked=undefined;
    await expect(page.getByText('Bu taslak başka bir cihazda değişti.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Mesaj gönder',exact:true})).toBeDisabled();
    expect(posts).toBe(0);await expect(input(page)).toHaveValue('Bu cihazdaki taslak');
  }finally{await blocked?.abort().catch(()=>{});await second.close();}
});

test('a delayed PUT acknowledgement cannot restore a draft already sent from another device',async({page})=>{
  const {account,channel,path}=await setup(page);
  let release:(()=>void)|undefined;
  await page.route(`**${path}`,async route=>{
    if(route.request().method()!=='PUT')return route.continue();
    const response=await route.fetch();
    await new Promise<void>(resolve=>{release=resolve;});
    await route.fulfill({response});
  });
  try{
    await input(page).fill('Gönderilecek ortak taslak');
    await expect.poll(()=>Boolean(release)).toBe(true);
    const message=await page.request.post(`/api/channels/${channel.id}/messages`,{headers:{Origin:origin},data:{content:'Gönderilecek ortak taslak'}});
    expect(message.status()).toBe(201);
    await expect(input(page)).toHaveValue('');
    const after=await(await page.request.get(path)).json();
    release!();release=undefined;
    await expect.poll(()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null')?.revision,`mola:draft:${account.user.id}:${account.workspace.id}:${channel.id}::sync`)).toBe(after.revision);
    await page.unroute(`**${path}`);
    await page.reload();await expect(input(page)).toHaveValue('');
    expect((await(await page.request.get(path)).json()).content).toBe('');
  }finally{release?.();}
});

test('a previously synchronized local cache does not resurrect a draft sent while its tab was closed',async({page})=>{
  const {channel,path}=await setup(page);
  await input(page).fill('Diğer cihazdan gönderilen taslak');
  await expect.poll(async()=>(await(await page.request.get(path)).json()).content).toBe('Diğer cihazdan gönderilen taslak');
  await page.goto('about:blank');
  expect((await page.request.post(origin+`/api/channels/${channel.id}/messages`,{headers:{Origin:origin},data:{content:'Diğer cihazdan gönderilen taslak'}})).status()).toBe(201);
  await page.goto(origin);await expect(input(page)).toHaveValue('');
  expect((await(await page.request.get(path)).json()).content).toBe('');
});

test('retry after an initial draft fetch failure loads the remote revision and syncs local text',async({page})=>{
  const {path}=await setup(page);
  await page.route(`**${path}`,route=>route.abort());
  await page.reload();await expect(input(page)).toBeVisible();
  await expect(page.getByText('Taslak bu cihazda',{exact:false})).toBeVisible();
  await input(page).fill('İlk yükleme sonrasında korunacak');
  await page.unroute(`**${path}`);
  await page.getByRole('button',{name:'Yeniden dene',exact:true}).click();
  await expect.poll(async()=>(await(await page.request.get(path)).json()).content).toBe('İlk yükleme sonrasında korunacak');
});
