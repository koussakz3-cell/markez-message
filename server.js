// MARKEZ MESSAGE - serveur de test, sans dépendances. Démarrage : node server.js
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
const PORT=process.env.PORT||3000;
const FILE=process.env.DATA_FILE||path.join(__dirname,"data.json");
let DB={users:{},tokens:{},msgs:[],seq:0,cids:{}};
try{DB=Object.assign(DB,JSON.parse(fs.readFileSync(FILE,"utf8")));}catch(e){}
let tm=null;
function save(){clearTimeout(tm);tm=setTimeout(()=>{try{fs.writeFileSync(FILE,JSON.stringify(DB));}catch(e){console.error("sauvegarde impossible:",e.message);}},500);}
const clients={},tries={};
const FDIR=path.join(path.dirname(FILE),"files");try{fs.mkdirSync(FDIR,{recursive:true});}catch(e){}
DB.files=DB.files||{};DB.groups=DB.groups||{};DB.backups=DB.backups||{};const sg={};
function slim(k){const n=Date.now(),a=(sg[k]=(sg[k]||[]).filter(x=>n-x<600000));a.push(n);return a.length>40;}
function push(m){m.id=++DB.seq;m.ts=Date.now();DB.msgs.push(m);(clients[m.to]||[]).forEach(r=>r.write("event: msg\ndata: "+JSON.stringify(m)+"\n\n"));return m;}
function limitBytes(p){return(isPrem(p)?800:300)*1048576;}
function usedBytes(p){return Object.values(DB.files).filter(f=>f.from===p).reduce((a,f)=>a+f.size,0);}
const PH=/^\+[1-9]\d{6,14}$/;
function out(res,code,obj){res.writeHead(code,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify(obj));}
function body(req,max){max=max||20000;return new Promise((ok,ko)=>{let d="";req.on("data",c=>{d+=c;if(d.length>max){ko(new Error("Requête trop grande"));req.destroy();}});req.on("end",()=>{try{ok(d?JSON.parse(d):{});}catch(e){ko(new Error("JSON invalide"));}});});}
function hash(pw,salt){return crypto.scryptSync(pw,salt,32).toString("hex");}
const ADMIN_PAGE=`<!DOCTYPE html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Administration</title><body style="font-family:sans-serif;padding:16px;max-width:420px;margin:auto"><h2>Activer Premium</h2><p>À utiliser seulement après avoir vérifié un vrai paiement.</p><input id=k type=password placeholder="Clé d'administration" style="width:100%;padding:10px;margin:6px 0"><input id=p placeholder="Numéro (+237...)" style="width:100%;padding:10px;margin:6px 0"><input id=d value=30 type=number style="width:100%;padding:10px;margin:6px 0"><button onclick="go('premium')" style="padding:10px;width:100%;margin:6px 0">Activer Premium (nombre de jours ci-dessus)</button><button onclick="go('free')" style="padding:10px;width:100%">Repasser en gratuit</button><pre id=o></pre><script>async function go(pl){const r=await fetch('/api/admin/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k.value,phone:p.value,plan:pl,days:d.value})});o.textContent=JSON.stringify(await r.json(),null,1);}</script>`;
function isPrem(p){const u=DB.users[p];return !!u&&u.plan==="premium"&&(!u.until||u.until>Date.now());}
const DAY=86400000;
function days(phone){return isPrem(phone)?7:5;}
function newToken(phone){const k=crypto.randomBytes(24).toString("hex");DB.tokens[k]={phone,exp:Date.now()+days(phone)*DAY};save();return k;}
function session(phone,name){const token=newToken(phone);return{token,phone,name,plan:isPrem(phone)?"premium":"free",until:DB.users[phone].until||null,exp:DB.tokens[token].exp};}
function who(req,url){const h=req.headers.authorization||"";const k=h.startsWith("Bearer ")?h.slice(7):url.searchParams.get("token");const t=DB.tokens[k];if(!t)return null;if(typeof t==="string")return t;if(t.exp<Date.now()){delete DB.tokens[k];return null;}return t.phone;}
function limited(req){const ip=req.socket.remoteAddress,n=Date.now();const a=(tries[ip]=(tries[ip]||[]).filter(x=>n-x<600000));a.push(n);return a.length>20;}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,"http://x");
 try{
  const ST={"/manifest.webmanifest":["manifest.webmanifest","application/manifest+json"],"/sw.js":["sw.js","text/javascript"],"/icon-192.png":["icon-192.png","image/png"],"/icon-512.png":["icon-512.png","image/png"]};
  if(req.method==="GET"&&ST[url.pathname]){return fs.readFile(path.join(__dirname,ST[url.pathname][0]),(e,d)=>{if(e){res.writeHead(404);return res.end("introuvable");}res.writeHead(200,{"Content-Type":ST[url.pathname][1]});res.end(d);});}
  if(req.method==="GET"&&url.pathname==="/"){
   return fs.readFile(path.join(__dirname,"index.html"),(e,d)=>{if(e){res.writeHead(404);return res.end("index.html manquant");}res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(d);});}
  if(req.method==="POST"&&(url.pathname==="/api/register"||url.pathname==="/api/login")){
   if(limited(req))return out(res,429,{error:"Trop d'essais, réessayez plus tard"});
   const b=await body(req),phone=String(b.phone||""),pw=String(b.password||"");
   if(!PH.test(phone))return out(res,400,{error:"Numéro invalide (format +indicatif...)"});
   if(url.pathname==="/api/register"){
    const name=String(b.name||"").trim().slice(0,30);
    if(!name)return out(res,400,{error:"Nom requis"});
    if(pw.length<6)return out(res,400,{error:"Mot de passe : 6 caractères minimum"});
    if(DB.users[phone])return out(res,409,{error:"Ce numéro est déjà inscrit"});
    const salt=crypto.randomBytes(16).toString("hex");
    DB.users[phone]={name,salt,hash:hash(pw,salt)};
    return out(res,200,session(phone,name));}
   const u=DB.users[phone];
   if(!u||!crypto.timingSafeEqual(Buffer.from(hash(pw,u.salt)),Buffer.from(u.hash)))return out(res,401,{error:"Numéro ou mot de passe incorrect"});
   return out(res,200,session(phone,u.name));}
  if(url.pathname==="/admin"&&req.method==="GET"){res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});return res.end(ADMIN_PAGE);}
  if(url.pathname==="/api/admin/plan"&&req.method==="POST"){
   if(!process.env.ADMIN_KEY)return out(res,404,{error:"Administration désactivée (ADMIN_KEY non défini)"});
   if(limited(req))return out(res,429,{error:"Trop d'essais"});
   const b=await body(req),k=Buffer.from(String(b.key||"")),K=Buffer.from(process.env.ADMIN_KEY);
   if(k.length!==K.length||!crypto.timingSafeEqual(k,K))return out(res,401,{error:"Clé incorrecte"});
   const phone=String(b.phone||"");if(!DB.users[phone])return out(res,404,{error:"Numéro non inscrit"});
   if(b.plan==="premium"){const d=Math.min(Math.max(parseInt(b.days,10)||30,1),366);DB.users[phone].plan="premium";DB.users[phone].until=Date.now()+d*86400000;}else{DB.users[phone].plan="free";delete DB.users[phone].until;}
   save();return out(res,200,{phone,plan:isPrem(phone)?"premium":"free",until:DB.users[phone].until||null});}
  const me=who(req,url);
  if(!me)return out(res,401,{error:"Connexion requise"});
  if(url.pathname==="/api/visible"&&req.method==="POST"){const b=await body(req);DB.users[me].visible=!!b.v;save();return out(res,200,{visible:DB.users[me].visible});}
  if(url.pathname==="/api/suggest"){const q=(url.searchParams.get("q")||"").replace(/\D/g,"");if(q.length<5)return out(res,200,{list:[]});if(slim(me))return out(res,429,{error:"Trop de recherches, patientez"});
   return out(res,200,{list:Object.entries(DB.users).filter(([p,u])=>u.visible&&p!==me&&p.replace(/\D/g,"").includes(q)).slice(0,5).map(([p,u])=>({phone:p,name:u.name}))});}
  if(url.pathname==="/api/group"&&req.method==="POST"){
   const b=await body(req),name=String(b.name||"").trim().slice(0,40);
   if(!name)return out(res,400,{error:"Nom du groupe requis"});
   const ms=[...new Set([me,...(Array.isArray(b.members)?b.members:[]).map(String).filter(p=>DB.users[p])])];
   if(ms.length<2)return out(res,400,{error:"Ajoutez au moins un membre inscrit"});
   if(ms.length>30)return out(res,400,{error:"30 membres maximum"});
   const gid=crypto.randomBytes(8).toString("hex");DB.groups[gid]={name,owner:me,members:ms};
   ms.filter(p=>p!==me).forEach(p=>push({from:me,name:DB.users[me].name,to:p,text:"👥 "+DB.users[me].name+" vous a ajouté au groupe « "+name+" »",gid,gname:name,members:ms}));
   save();return out(res,200,{gid,members:ms});}
  if(url.pathname==="/api/discover"){if(slim(me))return out(res,429,{error:"Trop de recherches, patientez"});
   return out(res,200,{list:Object.entries(DB.users).filter(([p,u])=>u.visible&&p!==me).sort(()=>Math.random()-.5).slice(0,8).map(([p,u])=>({phone:p,name:u.name}))});}
  if(url.pathname==="/api/backup"){
   if(req.method==="POST"){const b=await body(req,2200000),d=String(b.data||"");if(!d||d.length>2000000)return out(res,400,{error:"Sauvegarde vide ou trop grande (2 Mo maximum)"});DB.backups[me]={ts:Date.now(),data:d};save();return out(res,200,{ts:DB.backups[me].ts,size:d.length});}
   const k=DB.backups[me];return k?out(res,200,k):out(res,404,{error:"Aucune sauvegarde dans le cloud"});}
  if(url.pathname==="/api/refresh"&&req.method==="POST"){const h=req.headers.authorization||"",k=h.startsWith("Bearer ")?h.slice(7):url.searchParams.get("token");DB.tokens[k]={phone:me,exp:Date.now()+days(me)*DAY};save();return out(res,200,{plan:isPrem(me)?"premium":"free",until:DB.users[me].until||null,exp:DB.tokens[k].exp});}
  if(url.pathname==="/api/upload"&&req.method==="POST"){
   for(const [k,f] of Object.entries(DB.files))if(!f.to&&Date.now()-f.ts>3600000){try{fs.unlinkSync(path.join(FDIR,k));}catch(e){}delete DB.files[k];}
   const b=await body(req,4500000),buf=Buffer.from(String(b.data||""),"base64");
   if(!buf.length||buf.length>3000000)return out(res,400,{error:"Fichier vide ou trop gros (3 Mo maximum)"});
   if(usedBytes(me)+buf.length>limitBytes(me))return out(res,413,{error:"Stockage serveur plein ("+limitBytes(me)/1048576+" Mo)"});
   const id=crypto.randomBytes(12).toString("hex");fs.writeFileSync(path.join(FDIR,id),buf);
   DB.files[id]={from:me,to:null,ts:Date.now(),name:String(b.name||"fichier").slice(0,80),type:String(b.type||"application/octet-stream").slice(0,60),size:buf.length};save();
   return out(res,200,{fid:id});}
  if(url.pathname.startsWith("/api/file/")){
   const id=url.pathname.slice(10),f=/^[a-f0-9]{24}$/.test(id)?DB.files[id]:null;
   if(!f||f.to!==me)return out(res,404,{error:"Fichier introuvable"});
   const buf=fs.readFileSync(path.join(FDIR,id));res.writeHead(200,{"Content-Type":f.type,"Content-Length":buf.length});res.end(buf);
   try{fs.unlinkSync(path.join(FDIR,id));}catch(e){}delete DB.files[id];save();return;}
  if(url.pathname==="/api/lookup"){const u=DB.users[url.searchParams.get("phone")];return out(res,200,{exists:!!u,name:u?u.name:null});}
  if(url.pathname==="/api/sync"){const s=+url.searchParams.get("since")||0;return out(res,200,{msgs:DB.msgs.filter(m=>m.to===me&&m.id>s).slice(0,200)});}
  if(url.pathname==="/api/send"&&req.method==="POST"){
   const b=await body(req),to=String(b.to||""),text=String(b.text||"").slice(0,2000),cid=String(b.cid||"");
   if(!text.trim()&&!b.fid)return out(res,400,{error:"Message vide"});
   if(b.gid){const g=DB.groups[String(b.gid)];if(!g||!g.members.includes(me))return out(res,404,{error:"Groupe introuvable"});
    const key=me+":"+cid;if(cid&&DB.cids[key])return out(res,200,{id:DB.cids[key],dup:true});
    let last=0;g.members.filter(p=>p!==me).forEach(p=>{last=push({from:me,name:DB.users[me].name,to:p,text,gid:String(b.gid),gname:g.name}).id;});
    if(cid)DB.cids[key]=last;save();return out(res,200,{id:last,ts:Date.now()});}
   if(!DB.users[to])return out(res,404,{error:"Ce numéro n'est pas encore inscrit"});
   const key=me+":"+cid;
   if(cid&&DB.cids[key])return out(res,200,{id:DB.cids[key],dup:true});
   let file;const fid=String(b.fid||"");if(fid){const f=DB.files[fid];if(!f||f.from!==me||f.to)return out(res,400,{error:"Pièce jointe invalide"});f.to=to;file={id:fid,name:f.name,type:f.type,size:f.size};}
   const m={id:++DB.seq,from:me,name:DB.users[me].name,to,text,ts:Date.now(),file};
   DB.msgs.push(m);if(cid)DB.cids[key]=m.id;save();
   (clients[to]||[]).forEach(r=>r.write("event: msg\ndata: "+JSON.stringify(m)+"\n\n"));
   return out(res,200,{id:m.id,ts:m.ts});}
  if(url.pathname==="/api/events"){
   res.writeHead(200,{"Content-Type":"text/event-stream","Cache-Control":"no-store",Connection:"keep-alive"});res.write(": ok\n\n");
   (clients[me]=clients[me]||new Set()).add(res);
   const hb=setInterval(()=>res.write(": ping\n\n"),25000);
   req.on("close",()=>{clearInterval(hb);clients[me].delete(res);});return;}
  out(res,404,{error:"Introuvable"});
 }catch(e){out(res,400,{error:e.message});}
});
server.listen(PORT,()=>console.log("MARKEZ serveur sur le port "+PORT));
