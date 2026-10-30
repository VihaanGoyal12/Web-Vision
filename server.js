const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const DB = path.join(ROOT, 'relay-data.json');
const seed = () => ({
  chargers: [
    { id:'CZ-101', name:'Bandra East Hub', power:60, connector:'CCS2', status:'AVAILABLE', health:'Healthy', lastSeen:Date.now() },
    { id:'CZ-102', name:'BKC Business Park', power:120, connector:'CCS2', status:'CHARGING', health:'Healthy', lastSeen:Date.now() },
    { id:'CZ-103', name:'Andheri Link Road', power:60, connector:'CCS2', status:'AVAILABLE', health:'Healthy', lastSeen:Date.now() },
    { id:'CZ-104', name:'Powai Lake Point', power:30, connector:'CCS2', status:'FAULTED', health:'Fault', lastSeen:Date.now() },
    { id:'CZ-105', name:'Lower Parel Station', power:60, connector:'CCS2', status:'AVAILABLE', health:'Healthy', lastSeen:Date.now() },
    { id:'CZ-106', name:'Thane Express Hub', power:120, connector:'CCS2', status:'OFFLINE', health:'Unreachable', lastSeen:Date.now()-180000 }
  ], reservations: [], sessions: [], payments: [], events: [
    { id:crypto.randomUUID(), at:Date.now(), type:'SYSTEM', message:'Relay orchestration service initialized', detail:'Demo environment · simulated charger network' }
  ], metrics:{ attempts:0, recovered:0, stuckBookings:0, stuckPayments:0 }
});
let state;
try { state = JSON.parse(fs.readFileSync(DB,'utf8')); } catch { state = seed(); persist(); }
function persist(){ fs.writeFileSync(DB, JSON.stringify(state,null,2)); }
function event(type,message,detail=''){ state.events.unshift({id:crypto.randomUUID(),at:Date.now(),type,message,detail}); state.events=state.events.slice(0,80); }
function send(res,status,data){ res.writeHead(status,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(JSON.stringify(data)); }
function body(req){ return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch(e){reject(e);}});}); }
function snapshot(){ return {...state, serverTime:Date.now()}; }
function release(reservation,reason){
  if (!reservation || reservation.status !== 'ACTIVE') return;
  reservation.status='RELEASED'; reservation.releasedAt=Date.now(); reservation.releaseReason=reason;
  const charger=state.chargers.find(c=>c.id===reservation.chargerId);
  if(charger && charger.status==='RESERVED') charger.status='AVAILABLE';
  const payment=state.payments.find(p=>p.reservationId===reservation.id && p.status==='HELD');
  if(payment){payment.status='RELEASED';payment.releasedAt=Date.now();}
}
async function route(req,res){
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/api/state') return send(res,200,snapshot());
  if(req.method==='POST' && url.pathname==='/api/reserve'){
    const b=await body(req); const charger=state.chargers.find(c=>c.id===b.chargerId);
    if(!charger || charger.status!=='AVAILABLE' || charger.health!=='Healthy') return send(res,409,{error:'This charger is no longer available. Refresh and choose another.'});
    if(state.reservations.some(r=>r.status==='ACTIVE' && r.userId===(b.userId||'rahul'))) return send(res,409,{error:'You already have an active reservation.'});
    const r={id:'RES-'+String(Date.now()).slice(-6),userId:b.userId||'rahul',userName:'Rahul Sharma',chargerId:charger.id,status:'ACTIVE',createdAt:Date.now(),expiresAt:Date.now()+15*60*1000};
    state.reservations.unshift(r); charger.status='RESERVED';
    state.payments.unshift({id:'PAY-'+String(Date.now()).slice(-6),reservationId:r.id,amount:500,status:'HELD',createdAt:Date.now()});
    event('BOOKING',`${r.id} reserved ${charger.id}`,'₹500 payment hold placed · 15-minute reservation lease');persist();return send(res,201,{reservation:r,state:snapshot()});
  }
  if(req.method==='POST' && url.pathname==='/api/simulate/start-failure'){
    const b=await body(req);const r=state.reservations.find(x=>x.id===b.reservationId && x.status==='ACTIVE');
    if(!r)return send(res,404,{error:'Active reservation not found.'});
    state.metrics.attempts++; const session={id:'SES-'+String(Date.now()).slice(-6),reservationId:r.id,chargerId:r.chargerId,status:'START_FAILED',startedAt:Date.now()};state.sessions.unshift(session);
    event('FAULT',`Start command failed at ${r.chargerId}`,'Charger did not acknowledge session start · simulating lost/failed start response');
    // Atomic compensation: end failed session, release lease, release payment hold.
    session.status='ROLLED_BACK';session.endedAt=Date.now();release(r,'CHARGER_START_FAILED');state.metrics.recovered++;
    event('RECOVERY','Automatic rollback completed',`${r.id} released · ₹500 hold released · retry enabled`);persist();return send(res,200,{message:'Failure recovered automatically. Reservation and payment hold released.',state:snapshot()});
  }
  if(req.method==='POST' && url.pathname==='/api/retry'){
    const b=await body(req);const c=state.chargers.find(x=>x.id===b.chargerId);
    if(!c || c.status!=='AVAILABLE' || c.health!=='Healthy')return send(res,409,{error:'Selected charger is unavailable.'});
    return send(res,200,{message:'Retry is available. Create a fresh reservation.',state:snapshot()});
  }
  if(req.method==='POST' && url.pathname==='/api/simulate/heartbeat-loss'){
    const b=await body(req);const c=state.chargers.find(x=>x.id===b.chargerId);if(!c)return send(res,404,{error:'Charger not found.'});
    c.status='OFFLINE';c.health='Unreachable';c.lastSeen=Date.now()-180000;
    const r=state.reservations.find(x=>x.chargerId===c.id && x.status==='ACTIVE');if(r)release(r,'HEARTBEAT_TIMEOUT');
    event('CONNECTIVITY',`${c.id} marked OFFLINE`,'Heartbeat timeout · new bookings blocked'+(r?' · active reservation compensated':''));persist();return send(res,200,{state:snapshot()});
  }
  if(req.method==='POST' && url.pathname==='/api/simulate/session-ended'){
    const b=await body(req);const r=state.reservations.find(x=>x.id===b.reservationId);if(!r)return send(res,404,{error:'Reservation not found.'});
    const session=state.sessions.find(x=>x.reservationId===r.id && x.status==='CHARGING');
    if(session){session.status='COMPLETED';session.endedAt=Date.now();}
    release(r,'SESSION_RECONCILED');event('RECONCILIATION','Session/payment states reconciled',`${r.id} closed · payment hold released`);persist();return send(res,200,{state:snapshot()});
  }
  if(req.method==='POST' && url.pathname==='/api/reset') {state=seed();persist();return send(res,200,{state:snapshot()});}
  if(req.method==='GET'){
    let file=path.join(ROOT,decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('Forbidden');}
    fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('Not found');}const ext=path.extname(file);const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);});return;
  }
  send(res,404,{error:'Route not found'});
}
http.createServer((req,res)=>route(req,res).catch(e=>{console.error(e);send(res,500,{error:'Server error'});})).listen(PORT,()=>console.log(`ChargeZone Relay running at http://localhost:${PORT}/relay.html`));
