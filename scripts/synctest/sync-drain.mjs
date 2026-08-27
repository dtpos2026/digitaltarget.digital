// ============================================================================
// Sync drain test — does a large backlog actually reach the backend?
//
// THE REPORT THIS ANSWERS: "sync drops records, hangs, or gets stuck past
// ~1300 records". Before v1.28.2 flushDeferredOps() awaited one upload per
// record, serially, holding the flush lock: 1300 records meant 1300 sequential
// round trips, which operators saw as a permanent "Syncing…" and reloaded —
// putting the backlog back at the start.
//
// This seeds a device with a backlog, flushes it, and then counts the rows the
// BACKEND actually holds. Reporting `flushed: n` is not evidence; rows are.
//
//   node scripts/synctest/sync-drain.mjs                 3000 menu items
//   SEED=500 ORDERS=1 node scripts/synctest/sync-drain.mjs   500 bills
//
// Exit code 0 means every queued record is on the server and the queue is
// empty.
// ============================================================================
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const MOCK='http://127.0.0.1:54321', APP='http://127.0.0.1:5199';
const T='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', BRANCH='bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const root='/home/user/digitaltarget.digital', kids=[];
process.on('exit',()=>kids.forEach(c=>{try{process.kill(-c.pid,'SIGKILL')}catch{}}));
const start=(cmd,args,re,ms,env)=>{const c=spawn(cmd,args,{cwd:root,stdio:['ignore','pipe','inherit'],detached:true,env:{...process.env,...(env||{})}});kids.push(c);
  return new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error(cmd)),ms);c.stdout.on('data',d=>{if(re.test(String(d))){clearTimeout(t);res()}})})};
await Promise.all([
  start(process.execPath,[root+'/scripts/synctest/mock-supabase.mjs'],/mock-supabase on/,10000),
  start('npx',['vite','--port','5199','--host','127.0.0.1','--strictPort'],/ready in|Local:/,120000,{VITE_SUPABASE_URL:MOCK}),
]);
const N=Number(process.env.SEED||250);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-proxy-server']});
const page=await (await b.newContext()).newPage();
if (process.env.ORDERS) await page.addInitScript(()=>{window.__ORDERS__=true});
await page.addInitScript(({T,BRANCH,N})=>{
  const exp=Math.floor(Date.now()/1000)+3600;
  const b64=o=>btoa(JSON.stringify(o)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const am={tenant_id:T,branch_id:BRANCH,role:'admin',all_branches:true};
  const jwt=[b64({alg:'HS256',typ:'JWT'}),b64({sub:'dev-a',exp,aud:'authenticated',role:'authenticated',app_metadata:am}),'sig'].join('.');
  localStorage.setItem('dtpos-auth',JSON.stringify({access_token:jwt,refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:exp,
    user:{id:'dev-a',aud:'authenticated',role:'authenticated',email:'a@x.test',app_metadata:am,user_metadata:{},created_at:new Date().toISOString()}}));
  localStorage.setItem('pos-tenant-id',T);localStorage.setItem('pos-user-id','u1');
  localStorage.setItem('pos-user-role','admin');localStorage.setItem('dtpos-auth-backend','supabase');
  localStorage.setItem('dt_pos_current_user',JSON.stringify({id:'u1',name:'Admin',username:'admin',role:'admin'}));
  localStorage.setItem('dt_pos_current_branch',JSON.stringify({id:BRANCH,name:'Main Branch'}));
  const base={_tenantId:T,settings:{name:'D2',currencyCode:'PKR',businessTypeSetupDone:true},orderCounter:0};
  for(const k of ['orders','categories','menuItems','tables','floors','kitchens','waiters','riders','users','inventory','stockLogs','employees','attendance','leaves','payslips','advances','accountCategories','transactions','parties','ledger','dailyCashCloses','receivingEntries','marketingContacts','recipes','wastages','customers','branches','creditPayments','promoCodes','paymentAccounts','deals','shifts','refunds'])base[k]=[];
  base.users=[{id:'u1',name:'Admin',username:'admin',role:'admin',isActive:true,_updatedAt:Date.now()}];
  base.branches=[{id:BRANCH,name:'Main Branch',isActive:true,sortOrder:0,_updatedAt:Date.now()}];
  base.categories=[{id:'cat-1',name:'Main',sortOrder:0,_updatedAt:Date.now()}];
  const now=Date.now();
  if (window.__ORDERS__) {
    for(let i=0;i<N;i++)base.orders.push({id:`ord-${i}`,orderNumber:i+1,orderType:'dining',status:'paid',branchId:BRANCH,
      items:[{id:`oi-${i}`,menuItemId:'mi-0',name:'Dish',price:250,quantity:1,lineTotal:250,pricingType:'fixed',note:''}],
      payments:[{id:`p-${i}`,method:'cash',amount:250,at:new Date(now-i*1000).toISOString()}],
      subtotal:250,discount:0,tax:0,grandTotal:250,paymentMethod:'cash',amountPaid:250,
      createdAt:new Date(now-i*60000).toISOString(),_updatedAt:now-i});
    base.orderCounter=N;
  } else {
    for(let i=0;i<N;i++)base.menuItems.push({id:`mi-${i}`,name:`Dish ${i}`,price:100,categoryId:'cat-1',isActive:true,pricingType:'fixed',ratePerKg:0,flavors:[],sizeVariants:[],inchVariants:[],_updatedAt:now-i});
  }
  localStorage.setItem(`desi-pos-data:${T}`,JSON.stringify(base));
},{T,BRANCH,N});
await page.goto(APP+'/#/',{waitUntil:'domcontentloaded'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await wait(9000);
const tbl = async () => {
  const d = await (await fetch(MOCK + '/__dump')).json();
  return Object.fromEntries(Object.entries(d.tables || {}).filter(([, v]) => v.length).map(([k, v]) => [k, v.length]));
};
const table = process.env.ORDERS ? 'orders' : 'menu_items';

const before = await tbl();
const t0 = Date.now();
const r = await page.evaluate(async () => {
  const ds = await import('/src/lib/deferredSync.ts');
  const pending = ds.deferredPendingCount();
  const res = await ds.flushDeferredOps();
  return { pending, res, after: ds.deferredPendingCount(), progress: ds.getSyncProgress() };
});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const after = await tbl();

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

console.log(`\n  seeded ${N} ${table} · queue held ${r.pending} operation(s) · flush took ${secs}s`);
console.log(`  backend before: ${JSON.stringify(before)}`);
console.log(`  backend after:  ${JSON.stringify(after)}\n`);

check(`all ${N} records reached the backend`,
  (after[table] ?? 0) >= N, `${after[table] ?? 0}/${N} row(s) on the server`);
check('the queue drained completely',
  r.after === 0, `${r.after} operation(s) left`);
check('nothing was dead-lettered',
  (r.res.deadLettered ?? 0) === 0, `${r.res.deadLettered ?? 0} parked`);
check('the engine agrees with the backend',
  r.res.flushed === r.pending, `reported ${r.res.flushed} of ${r.pending}`);
check('progress finished cleanly',
  r.progress.running === false && r.progress.processedCount === r.progress.totalCount,
  `${r.progress.processedCount}/${r.progress.totalCount}, running=${r.progress.running}`);

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
await b.close();
process.exit(passed === results.length ? 0 : 1);
