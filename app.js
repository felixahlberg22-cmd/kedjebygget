/* Kedjebygget — applogik. Laddas som vanligt skript (inte modul) så att sidan fungerar från file://.
   Kräver ics.js före sig (global ICS). */
(function(){
"use strict";

// Enheterna räknas fram per uppställning. Antalet femmor, PP, BP och målvakter kan ändras på träning
// (s.count); övertid och forcering finns bara på match. Data i dolda enheter ligger kvar i s.units.
var BASE={ev:4,pp:2,bp:2,gk:2};
var GROUP={ev:{k:'L',name:'Femma',slots:['VF','C','HF','VB','HB']},pp:{k:'PP',name:'Powerplay',slots:['F','F','F','F','B']},
  bp:{k:'BP',name:'Boxplay',slots:['F','F','B','B']}};
var OT={k:'OT',name:'Övertid 3-3',grp:'ot',slots:['F','F','B']},FC={k:'FC',name:'Slutforcering',grp:'forc',slots:['F','F','F','F','B','B']};
function countOf(s,g){return (s.count&&s.count[g])||BASE[g];}
function unitsOf(s){
  var tr=modeOf(s)==='traning',out=[];
  ['ev','pp','bp'].forEach(function(g){
    for(var i=1;i<=countOf(s,g);i++)out.push({k:GROUP[g].k+i,name:GROUP[g].name+' '+i,grp:g,slots:GROUP[g].slots});
  });
  if(!tr){out.push(OT);out.push(FC);}
  var gk=[];
  for(var i=0;i<countOf(s,'gk');i++)gk.push(tr?'MV':i===0?'Start':i===1?'Back-up':'MV '+(i+1));
  out.push({k:'GK',name:'Målvakter',grp:'gk',slots:gk});
  return out;
}
function unitDef(s,k){var u=unitsOf(s);for(var i=0;i<u.length;i++){if(u[i].k===k)return u[i];}return null;}
function evKeys(s){return unitsOf(s).filter(function(u){return u.grp==='ev';}).map(function(u){return u.k;});}
function ensureUnits(s){
  unitsOf(s).forEach(function(u){var a=s.units[u.k]||(s.units[u.k]=[]);while(a.length<u.slots.length)a.push(null);});
}
function resetUnits(s){s.units={};ensureUnits(s);}

var TYPE={match:'Match',traning:'Träning',ovrigt:'Övrigt'};
var WORD={ja:'Kommer',nej:'Kommer inte',ej_svarat:'Ej svarat'};

// Västfärger för femmorna på träning. ink = textfärg ovanpå färgen.
var VEST=[['rod','Röd','#d62f3a','#fff'],['bla','Blå','#1f5fbf','#fff'],['vit','Vit','#ffffff','#0d1d2b'],['svart','Svart','#1b1f24','#fff'],
  ['gul','Gul','#f2c230','#0d1d2b'],['gron','Grön','#2e9b57','#fff'],['orange','Orange','#ef7b22','#fff'],['gra','Grå','#8a96a3','#fff'],['lila','Lila','#7a4cc2','#fff']]
  .map(function(v){return {id:v[0],name:v[1],hex:v[2],ink:v[3]};});
var DEFAULT_VEST=['rod','bla','vit','svart','gul','gron','orange','gra','lila'];
var GRPC={ev:'#10528f',pp:'#1a6f4a',bp:'#b02a37',ot:'#9a6a05',forc:'#9a6a05',gk:'#8a6a10'};
function vest(id){for(var i=0;i<VEST.length;i++){if(VEST[i].id===id)return VEST[i];}return VEST[0];}

// Länk till formuläret bakom "Tyck till". Tom = knappen säger att länken saknas (byt innan publicering).
var FEEDBACK_URL='https://forms.gle/sVTtNEhbVCycmHFv6';

// Egen nyckel: sidor från file:// delar localStorage i Chrome, och KTH-versionen använder 'kedjebygget-v1'.
var KEY='kedjebygget-tjanst-v1';
var S={roster:[],sets:[],active:null,activities:[],view:'lineup'};
var sel=null,selFrom=null; // vald spelare för tryck-och-placera

function $(id){return document.getElementById(id);}

/* ---------- lagring ---------- */
function save(){try{localStorage.setItem(KEY,JSON.stringify(S));}catch(e){}}
function load(){
  try{var r=localStorage.getItem(KEY);if(r){var p=JSON.parse(r);if(p&&p.roster&&p.sets){S=p;migrate();return true;}}}catch(e){}
  return false;
}
// Äldre sparad data: frånvaro låg på spelaren, nu per uppställning. Enheter som saknas fylls på tomma.
function migrate(){
  if(!S.activities)S.activities=[];
  if(!S.view)S.view='lineup';
  S.sets.forEach(function(s){
    if(!s.off){s.off={};S.roster.forEach(function(p){if(p.off)s.off[p.id]=true;});}
    if(!s.units)s.units={};
    ensureUnits(s);
  });
  S.roster.forEach(function(p){delete p.off;});
}
function uid(){return Math.random().toString(36).slice(2,9);}

function newSet(name,date){var s={id:uid(),name:name||'Ny uppställning',date:date||today(),units:{},off:{}};ensureUnits(s);return s;}
function active(){for(var i=0;i<S.sets.length;i++){if(S.sets[i].id===S.active)return S.sets[i];}return S.sets[0];}
function P(id){for(var i=0;i<S.roster.length;i++){if(S.roster[i].id===id)return S.roster[i];}return null;}
function isOff(p){return !!active().off[p.id];}

// Ny installation startar tom: truppen fylls via närvaroinklistring (+ Lägg till i truppen) eller för hand.
function seed(){
  var s=newSet('Ny uppställning');
  S.roster=[];S.sets=[s];S.active=s.id;S.activities=[];S.view='lineup';
}

/* ---------- datum ---------- */
function pad(n){return (n<10?'0':'')+n;}
function today(){var d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function dayOf(x){return String(x.start).slice(0,10);}
function timeOf(x){var m=/T(\d{2}:\d{2})/.exec(x.start);return m?m[1]:'';}
function fmtDay(s,opts){
  var p=String(s).split('-');
  try{return new Date(+p[0],p[1]-1,+p[2]).toLocaleDateString('sv-SE',opts);}catch(e){return s;}
}
function byStart(a,b){return a.start<b.start?-1:a.start>b.start?1:0;}

/* ---------- placering ---------- */
function place(pid,uk,idx,from){
  var s=active(),L=s.units,u=unitDef(s,uk),EV=evKeys(s);
  var occ=L[uk][idx];
  if(from) L[from.u][from.i]=null;
  if(u.grp==='ev'){EV.forEach(function(k){L[k]=L[k].map(function(x){return x===pid?null:x;});});}
  else {L[uk]=L[uk].map(function(x){return x===pid?null:x;});}
  L[uk][idx]=pid;
  if(occ&&occ!==pid&&from){
    var su=unitDef(s,from.u),clash;
    if(su.grp==='ev'){clash=EV.some(function(k){return L[k].indexOf(occ)>-1;});}
    else {clash=L[from.u].indexOf(occ)>-1;}
    if(!clash&&!L[from.u][from.i]) L[from.u][from.i]=occ;
  }
  save();render();
}
function clearSlot(uk,idx){active().units[uk][idx]=null;save();render();}
function loadOf(pid){var s=active(),n=0;unitsOf(s).forEach(function(u){if(s.units[u.k].indexOf(pid)>-1)n++;});return n;}

/* ---------- aktiviteter ---------- */
function actById(id){for(var i=0;i<S.activities.length;i++){if(S.activities[i].id===id)return S.activities[i];}return null;}
function actOf(set){return set&&set.activityId?actById(set.activityId):null;}
// Träning eller match styr export och västfärger. Väljs automatiskt från aktiviteten tills tränaren byter själv.
function modeOf(s){return s.mode||((actOf(s)||{}).type==='traning'?'traning':'match');}
// Senast valda färger blir förval på nästa uppställning.
function colorsOf(s){
  var c=s.colors||(s.colors={});
  evKeys(s).forEach(function(k,i){if(!c[k])c[k]=(S.lastColors&&S.lastColors[k])||DEFAULT_VEST[i%DEFAULT_VEST.length];});
  return c;
}
function setColor(k,id){
  colorsOf(active())[k]=id;
  S.lastColors=S.lastColors||{};S.lastColors[k]=id;
  save();
}
function setFor(aid){for(var i=0;i<S.sets.length;i++){if(S.sets[i].activityId===aid)return S.sets[i];}return null;}

function importText(txt,fname,quiet){
  var list=null;
  try{
    if(/^\s*[\[{]/.test(txt)){var j=JSON.parse(txt);list=Array.isArray(j)?j:j.activities;}
    else list=ICS.parse(txt);
  }catch(e){list=null;}
  if(!list||!list.length){if(!quiet)say('Hittade inga aktiviteter i '+fname+'.');return;}
  var added=0,updated=0;
  list.forEach(function(n){
    if(!n||!n.id||!n.start)return;
    var o=actById(String(n.id));
    if(o){
      o.type=n.type||o.type;o.start=n.start;o.end=n.end||'';o.gather=n.gather||'';o.title=n.title||o.title;
      o.location=n.location||'';o.cancelled=!!n.cancelled;
      if(n.attending&&n.attending.length){o.attending=n.attending;applyAtt(o);}
      updated++;
    }else{
      var x={id:String(n.id),type:n.type||ICS.classify(n.title),start:n.start,end:n.end||'',gather:n.gather||'',title:n.title||'Aktivitet',
        location:n.location||'',cancelled:!!n.cancelled,attending:n.attending||[]};
      S.activities.push(x);added++;
    }
  });
  var r=removeMissing(list);
  save();render();
  var msg=[];
  if(added)msg.push(added+(added>1?' nya':' ny'));
  if(!quiet&&updated)msg.push(updated+' uppdaterade');
  if(r.removed)msg.push(r.removed+(r.removed>1?' borttagna':' borttagen'));
  var tail=r.unlinked?' '+r.unlinked+(r.unlinked>1?' uppställningar ligger':' uppställning ligger')+' kvar utan aktivitet.':'';
  if(r.skipped)say('Kalendern saknar '+r.skipped+' aktiviteter som finns här — tog inte bort dem, kontrollera flödet.');
  else if(msg.length)say((quiet?'Kalendern uppdaterad: ':'')+msg.join(', ')+'.'+tail);
  else if(!quiet)say('Inget nytt — allt stämmer redan.');
}

// Aktiviteter som försvunnit ur laget.se tas bort, så att appen speglar flödet. Bara inom flödets tidsspann:
// flödet kan sakna gammal historik, och det som ligger före första aktiviteten i flödet rörs inte.
// Uppställningar raderas aldrig — de kopplas bara loss. Om nästan allt verkar ha försvunnit är flödet
// troligen trasigt, och då tas ingenting bort.
function removeMissing(list){
  var ids={},min=null;
  list.forEach(function(n){
    if(!n||!n.id||!n.start)return;
    ids[String(n.id)]=1;
    var d=String(n.start).slice(0,10);if(!min||d<min)min=d;
  });
  var res={removed:0,unlinked:0,skipped:0};
  if(!min)return res;
  var inRange=S.activities.filter(function(x){return dayOf(x)>=min;});
  var gone=inRange.filter(function(x){return !ids[x.id];});
  if(!gone.length)return res;
  if(gone.length>3&&gone.length>inRange.length/2){res.skipped=gone.length;return res;}
  var g={};gone.forEach(function(x){g[x.id]=1;});
  S.activities=S.activities.filter(function(x){return !g[x.id];});
  S.sets.forEach(function(s){if(s.activityId&&g[s.activityId]){delete s.activityId;res.unlinked++;}});
  res.removed=gone.length;
  return res;
}

function openLineup(aid){
  var x=actById(aid);if(!x)return;
  var s=setFor(aid);
  if(!s){
    s=newSet(x.title,dayOf(x));s.activityId=x.id;
    var off=attOff(x);if(off)s.off=off;
    S.sets.push(s);
  }
  S.active=s.id;S.view='lineup';sel=null;save();render();
  window.scrollTo(0,0);
}

// En aktivitet äger högst en uppställning, och en kopplad uppställning flyttas aldrig. Bara fria uppställningar
// kan kopplas, och bara till aktiviteter som saknar uppställning — annars skulle en färdig uppställning tappas.
function linkSet(aid){
  var s=active(),x=actById(aid);
  if(!x||s.activityId||setFor(aid)){render();return;}
  s.activityId=aid;s.name=x.title;s.date=dayOf(x);
  var off=attOff(x);if(off)s.off=off;
  save();render();
}

/* ---------- närvaro: tolkning och namnmatchning ---------- */
function norm(s){
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
    .replace(/[^a-z\s-]/g,' ').replace(/-/g,' ').replace(/\s+/g,' ').trim();
}
function lev(a,b){
  if(a===b)return 0;
  var m=a.length,n=b.length,prev=[],cur,i,j;
  for(j=0;j<=n;j++)prev[j]=j;
  for(i=1;i<=m;i++){
    cur=[i];
    for(j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    prev=cur;
  }
  return prev[n];
}
function ratio(a,b){var L=Math.max(a.length,b.length);return L?1-lev(a,b)/L:0;}

// 0–1. Klarar omvänd ordning ("Efternamn Förnamn"), mellannamn, förkortat efternamn och stavfel.
function nameScore(a,b){
  if(!a||!b)return 0;
  if(a===b)return 1;
  var ta=a.split(' '),tb=b.split(' ');
  var sa=ta.slice().sort().join(' '),sb=tb.slice().sort().join(' ');
  if(sa===sb)return .98;
  var r=Math.max(ratio(a,b),ratio(sa,sb));
  var short=ta.length<=tb.length?ta:tb,long=short===ta?tb:ta;
  if(short.length>1&&short.every(function(t){return long.indexOf(t)>-1;}))r=Math.max(r,.93);
  if(ta.length>1&&tb.length>1&&ta[0]===tb[0]){
    var la=ta[ta.length-1],lb=tb[tb.length-1];
    if(la.indexOf(lb)===0||lb.indexOf(la)===0)r=Math.max(r,.9);
  }
  return r;
}

var AUTO=.82;
// Kopplar namn från laget.se till spelare i truppen. Sparad manuell koppling (lagetId) går först,
// sedan bästa poäng — varje spelare kopplas högst en gång.
function matchNames(names){
  var ns=names.map(norm),pairs=[],res=names.map(function(){return {pid:null,cands:[]};});
  ns.forEach(function(n,i){
    var sc=S.roster.map(function(p){
      var s=p.lagetId&&p.lagetId===n?1.01:nameScore(n,norm(p.name));
      if(s>=AUTO)pairs.push([s,i,p.id]);
      return [s,p.id];
    });
    sc.sort(function(a,b){return b[0]-a[0];});
    res[i].cands=sc.map(function(x){return x[1];});
  });
  pairs.sort(function(a,b){return b[0]-a[0];});
  var used={};
  pairs.forEach(function(q){if(!res[q[1]].pid&&!used[q[2]]){res[q[1]].pid=q[2];used[q[2]]=1;}});
  return res;
}

function statusOf(t){
  t=String(t||'').toLowerCase();
  if(/(inte|ej)\s+svar|obesvar|inget svar|ok[äa]n|v[äa]ntar/.test(t))return 'ej_svarat';
  if(/(kommer|deltar)\s+(inte|ej)|\bnej\b|avb[öo]j|fr[åa]nvar|kan inte|f[öo]rhinder/.test(t))return 'nej';
  if(/kommer|\bja\b|deltar|anm[äa]ld|n[äa]rvar|accept/.test(t))return 'ja';
  return null;
}
var STATUS_LINE=/^(deltar|deltar ej|deltar inte|kommer|kommer inte|kommer ej|ej svarat|inte svarat|har inte svarat|ja|nej|tackat ja|tackat nej|avböjt|avböjda|anmäld|anmälda|frånvarande|närvarande|obesvarade?|okänd|okänt)$/i;
var JUNK=/^(välj alla|namn|kommentar|anmälan|närvaro|schemalägg\b.*|skicka påminnelse\b.*|visa fler\b.*|visa alla\b.*)$/i;
var LEADERS=/^(ledare|tränare|ledare och tränare|funktionärer)$/i;
var PLAYERS=/^(spelare|deltagare|aktiva|kallade|medlemmar)$/i;
var NAMELIKE=/^[A-ZÅÄÖÉÜ]\S*(\s+[A-ZÅÄÖÉÜ]\S*){1,3}$/;

// Klarar tre format:
//  1. laget.se-kallelsen: namn, ev. kommentarsrad, sedan status på egen rad ("Deltar", "Deltar ej", "Ej svarat").
//     Namn utan status (ej kallade) räknas som ej svarat. Allt under rubriken "Ledare" hoppas över.
//  2. Rubriker följda av namn: "Kommer" / namn / namn / "Kommer inte" / namn.
//  3. Status på samma rad: "Namn - Kommer", "Namn<tabb>Deltar ej".
function parseAttendance(txt){
  var out=[],seen={},section=null,skip=false,pending=[],trailing=false;
  function add(name,status,comment){
    name=name.replace(/\s*\(.*?\)\s*/g,' ').trim();
    if(name.length<2||name.length>60||!/[a-zåäöéü]/i.test(name)||/\d{3,}/.test(name))return;
    var k=norm(name);if(!k||seen[k])return;seen[k]=1;
    out.push({name:name,status:status,comment:comment||''});
  }
  function flush(){pending.forEach(function(n){add(n,section,'');});pending=[];}
  String(txt).split(/\r?\n/).forEach(function(raw){
    var l=raw.replace(/^[\s\-–•*·#\d.)]+/,'').trim();
    if(!l){flush();return;}
    var bare=l.replace(/[():\d]/g,'').trim();
    if(LEADERS.test(bare)){flush();skip=true;return;}
    if(PLAYERS.test(bare)){flush();skip=false;section=null;return;}
    if(skip||JUNK.test(bare))return;
    if(STATUS_LINE.test(bare)){
      var st=statusOf(bare),forcedHead=/\(\d+\)|:$/.test(l);
      // Status direkt efter ett namn (ev. med en kommentarsrad emellan) hör till det namnet, annars är det en rubrik.
      if(!forcedHead&&(pending.length===1||(pending.length===2&&!NAMELIKE.test(pending[1])))){
        add(pending[0],st,pending[1]);pending=[];trailing=true;
      }else{flush();section=st;}
      return;
    }
    var parts=l.split(/\t| {2,}| [-–—|] |;/),name=parts[0].trim(),st2=statusOf(parts.slice(1).join(' '));
    if(!st2){
      var m=/^(.*?)\s+(kommer inte|kommer ej|kommer|deltar ej|deltar inte|deltar|ej svarat)$/i.exec(name);
      if(m){name=m[1];st2=statusOf(m[2]);}
    }
    if(st2){flush();add(name,st2,'');return;}
    pending.push(name);
  });
  flush();
  // I laget.se-formatet saknar bara de ej kallade status; i en ren namnlista betyder ett namn "kommer".
  var def=trailing?'ej_svarat':'ja';
  out.forEach(function(e){if(!e.status)e.status=def;});
  return out;
}

// Karta pid → true för dem som räknas som frånvarande. Spelare med 'ja' är tillgängliga, 'nej' alltid borta,
// och den som inte svarat eller saknas räknas bort bara i strikt läge.
function offFrom(entries,strict){
  var by={},off={};
  entries.forEach(function(e){if(e.pid)by[e.pid]=e.status;});
  S.roster.forEach(function(p){
    var st=by[p.id];
    if(st==='ja')return;
    if(st==='nej'||strict)off[p.id]=true;
  });
  return off;
}
function attOff(x){
  if(!x||!x.attending||!x.attending.length)return null;
  var miss=x.attending.filter(function(e){return !e.pid||!P(e.pid);});
  if(miss.length){
    var m=matchNames(miss.map(function(e){return e.name;}));
    miss.forEach(function(e,i){e.pid=m[i].pid;});
  }
  return offFrom(x.attending,x.strict!==false);
}
function applyAtt(x){
  var off=attOff(x);if(!off)return;
  S.sets.forEach(function(s){if(s.activityId===x.id){var o={};for(var k in off)o[k]=true;s.off=o;}});
}
function attSummary(list){
  var c={ja:0,nej:0,ej_svarat:0};
  list.forEach(function(e){c[e.status]=(c[e.status]||0)+1;});
  return '<b>'+c.ja+' kommer</b> · '+c.nej+' kommer inte'+(c.ej_svarat?' · '+c.ej_svarat+' ej svarat':'');
}

/* ---------- rendering ---------- */
var bench=$('bench'),unitsEl=$('units');

function chip(p){
  var el=document.createElement('div');
  el.className='chip';el.setAttribute('role','button');el.tabIndex=0;
  el.dataset.pid=p.id;
  var off=isOff(p);
  if(off)el.dataset.off='1';
  if(sel===p.id)el.dataset.sel='1';
  var n=loadOf(p.id);
  el.innerHTML='<span class="num">'+esc(p.num)+'</span><span class="nm">'+esc(p.name)+'</span>'+
    '<span class="tag '+p.pos+'">'+p.pos+'</span><span class="load" data-hot="'+(n>=4?1:0)+'">'+(n||'')+'</span>';
  el.title=off?'Frånvarande':'I '+n+' enheter';
  return el;
}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

function renderBench(){
  bench.innerHTML='';
  var order={F:0,B:1,MV:2};
  var list=S.roster.slice().sort(function(a,b){
    var ao=isOff(a),bo=isOff(b);
    if(ao!==bo)return ao?1:-1;
    if(order[a.pos]!==order[b.pos])return order[a.pos]-order[b.pos];
    return (parseInt(a.num,10)||99)-(parseInt(b.num,10)||99);
  });
  if(!list.length){
    var e=document.createElement('p');e.style.cssText='color:var(--muted);font-size:14px;margin:6px 4px';
    e.textContent='Truppen är tom. Lägg till spelare nedan.';bench.appendChild(e);
  }
  $('editRoster').setAttribute('aria-pressed',String(editing));
  $('editRoster').textContent=editing?'Klar':'Redigera';
  if(editing){list.forEach(function(p){bench.appendChild(editRow(p));});}
  else list.forEach(function(p){
    var c=chip(p),o=isOff(p);
    var t=document.createElement('button');
    t.className='x';t.type='button';t.textContent=o?'○':'●';
    t.title=o?'Markera som tillgänglig':'Markera som frånvarande';
    t.setAttribute('aria-label',(o?'Markera tillgänglig: ':'Markera frånvarande: ')+p.name);
    t.addEventListener('click',function(ev){
      ev.stopPropagation();
      var off=active().off;
      if(off[p.id])delete off[p.id];else off[p.id]=true;
      save();render();
    });
    c.appendChild(t);
    bench.appendChild(c);
  });
  var av=S.roster.filter(function(p){return !isOff(p);}).length;
  $('availCount').textContent=av+' av '+S.roster.length+' tillgängliga';
}

// Redigeringsläge i truppen: nummer, namn och position ändras på plats, × tar bort spelaren helt.
var editing=false;
function editRow(p){
  var r=document.createElement('div');
  r.className='editrow';
  r.innerHTML='<input class="num-in" data-f="num" inputmode="numeric" aria-label="Nummer för '+esc(p.name)+'" value="'+esc(p.num==='–'?'':p.num)+'">'+
    '<input type="text" data-f="name" aria-label="Namn" value="'+esc(p.name)+'">'+
    '<select data-f="pos" aria-label="Position för '+esc(p.name)+'">'+['F','B','MV'].map(function(x){
      return '<option'+(p.pos===x?' selected':'')+'>'+x+'</option>';}).join('')+'</select>'+
    '<button class="x" type="button" aria-label="Ta bort '+esc(p.name)+' ur truppen" title="Ta bort ur truppen">×</button>';
  r.addEventListener('change',function(e){
    var f=e.target.dataset.f;if(!f)return;
    var v=e.target.value.trim();
    if(f==='name'&&!v){e.target.value=p.name;return;}
    p[f]=f==='num'?(v||'–'):v;
    save();renderUnits();renderChecks();
  });
  r.querySelector('.x').addEventListener('click',function(){
    if(!confirm('Ta bort '+p.name+' ur truppen? Hen tas också bort ur alla uppställningar.'))return;
    removePlayer(p.id);
  });
  return r;
}
function removePlayer(pid){
  S.roster=S.roster.filter(function(p){return p.id!==pid;});
  S.sets.forEach(function(s){
    Object.keys(s.units).forEach(function(k){s.units[k]=s.units[k].map(function(x){return x===pid?null:x;});});
    delete s.off[pid];
  });
  S.activities.forEach(function(x){(x.attending||[]).forEach(function(e){if(e.pid===pid)e.pid=null;});});
  if(sel===pid)sel=null;
  save();render();
}

// Lägga till och ta bort enheter görs bara på träning. Bara den sista i varje grupp kan tas bort, så att
// numreringen hänger ihop, och minst en finns alltid kvar.
function addUnit(g){
  var a=active();a.count=a.count||{};a.count[g]=countOf(a,g)+1;
  ensureUnits(a);save();render();
}
function removeUnit(g){
  var a=active(),n=countOf(a,g);if(n<=1)return;
  if(g==='gk'){
    var who=a.units.GK[n-1]?P(a.units.GK[n-1]):null;
    if(who&&!confirm('Ta bort målvaktsplatsen med '+who.name+'?'))return;
    a.units.GK.length=n-1;
  }else{
    var k=GROUP[g].k+n,full=(a.units[k]||[]).filter(Boolean).length;
    if(full&&!confirm('Ta bort '+GROUP[g].name+' '+n+'? '+full+' spelare tas ur den.'))return;
    delete a.units[k];if(a.colors)delete a.colors[k];
  }
  a.count=a.count||{};a.count[g]=n-1;
  sel=null;save();render();
}

function renderUnits(){
  var a=active(),L=a.units,tr=modeOf(a)==='traning',units=unitsOf(a),last={};
  ensureUnits(a);
  units.forEach(function(u){last[u.grp]=u.k;});
  $('unitBar').hidden=!tr;
  if(tr)$('unitBar').innerHTML=[['ev','Femma'],['pp','Powerplay'],['bp','Boxplay'],['gk','Målvakt']].map(function(g){
    return '<button class="btn" type="button" data-add="'+g[0]+'">+ '+g[1]+'</button>';}).join('');
  unitsEl.innerHTML='';
  units.forEach(function(u){
    var sec=document.createElement('section');
    sec.className='unit';sec.dataset.grp=u.grp;
    var filled=L[u.k].filter(Boolean).length;
    var h=document.createElement('header');
    h.innerHTML='<h3>'+u.name+'</h3><span class="cnt">'+filled+'/'+u.slots.length+'</span>';
    if(tr&&last[u.grp]===u.k&&countOf(a,u.grp)>1){
      var rm=document.createElement('button');
      rm.className='x';rm.type='button';rm.textContent=u.grp==='gk'?'−':'×';
      rm.title=u.grp==='gk'?'Ta bort en målvaktsplats':'Ta bort '+u.name;
      rm.setAttribute('aria-label',rm.title);
      rm.addEventListener('click',function(){removeUnit(u.grp);});
      h.appendChild(rm);
    }
    if(u.grp==='ev'&&modeOf(active())==='traning'){
      var cur=vest(colorsOf(active())[u.k]),w=document.createElement('span');
      w.className='vestwrap';w.style.setProperty('--v',cur.hex);
      w.innerHTML='<select class="vestsel" aria-label="Västfärg för '+u.name+'">'+VEST.map(function(v){
        return '<option value="'+v.id+'"'+(v.id===cur.id?' selected':'')+'>'+v.name+'</option>';}).join('')+'</select>';
      w.firstChild.addEventListener('change',function(e){setColor(u.k,e.target.value);renderUnits();});
      h.insertBefore(w,h.querySelector('.cnt'));
    }
    sec.appendChild(h);
    var ol=document.createElement('ol');ol.className='slots';
    u.slots.forEach(function(role,i){
      var li=document.createElement('li');
      var s=document.createElement('div');
      s.className='slot';s.setAttribute('role','button');s.tabIndex=0;
      s.dataset.u=u.k;s.dataset.i=i;
      var pid=L[u.k][i],p=pid?P(pid):null;
      if(p){
        s.dataset.filled='1';s.dataset.pid=pid;
        s.innerHTML='<span class="role">'+role+'</span><span class="num">'+esc(p.num)+'</span><span class="nm">'+esc(p.name)+'</span>';
        var x=document.createElement('button');
        x.className='x';x.type='button';x.textContent='×';
        x.setAttribute('aria-label','Ta bort '+p.name+' från '+u.name);
        x.addEventListener('click',function(ev){ev.stopPropagation();clearSlot(u.k,i);});
        s.appendChild(x);
        s.setAttribute('aria-label',u.name+' '+role+': '+p.num+' '+p.name);
      }else{
        s.innerHTML='<span class="role">'+role+'</span><span class="empty">tom</span>';
        s.setAttribute('aria-label',u.name+' '+role+': tom');
      }
      li.appendChild(s);ol.appendChild(li);
    });
    sec.appendChild(ol);unitsEl.appendChild(sec);
  });
}

function renderChecks(){
  var a=active(),L=a.units,ul=$('checks'),out=[],EV=evKeys(a),tr=modeOf(a)==='traning';
  // På träning är det bara femmorna som behöver vara kompletta.
  var inc=unitsOf(a).filter(function(u){return (!tr||u.grp==='ev')&&L[u.k].filter(Boolean).length<u.slots.length;});
  if(inc.length) out.push(['warn','<b>Ofullständiga enheter:</b> '+inc.map(function(u){return u.name;}).join(', ')+'.']);
  var off=S.roster.filter(function(p){return isOff(p)&&loadOf(p.id)>0;});
  if(off.length) out.push(['warn','<b>Frånvarande men inlagda:</b> '+off.map(function(p){return esc(p.name);}).join(', ')+'.']);
  var hot=S.roster.filter(function(p){return loadOf(p.id)>=4;});
  if(hot.length) out.push(['warn','<b>Hög belastning (4+ enheter):</b> '+hot.map(function(p){return esc(p.name)+' ('+loadOf(p.id)+')';}).join(', ')+'.']);
  var bare=S.roster.filter(function(p){return !isOff(p)&&p.pos!=='MV'&&!EV.some(function(k){return L[k].indexOf(p.id)>-1;});});
  if(bare.length) out.push(['warn','<b>Tillgängliga utan femma:</b> '+bare.map(function(p){return esc(p.name);}).join(', ')+'.']);
  if(!out.length) out.push(['ok','Allt sitter. Alla enheter fulla, ingen frånvarande inlagd och ingen överbelastad.']);
  ul.innerHTML=out.map(function(o){return '<li class="'+o[0]+'">'+o[1]+'</li>';}).join('');
}

function whenOf(x){return fmtDay(dayOf(x),{weekday:'short',day:'numeric',month:'short'})+(timeOf(x)?' '+timeOf(x):'');}
function placed(s){var n=0;unitsOf(s).forEach(function(u){n+=(s.units[u.k]||[]).filter(Boolean).length;});return n;}
function slotsOf(s){return unitsOf(s).reduce(function(n,u){return n+u.slots.length;},0);}

function renderSets(){
  $('setPick').innerHTML=S.sets.slice().sort(function(a,b){return (a.date||'')<(b.date||'')?-1:(a.date||'')>(b.date||'')?1:0;}).map(function(s){
    var x=actOf(s);
    return '<option value="'+esc(s.id)+'"'+(s.id===S.active?' selected':'')+'>'+
      esc(x?whenOf(x)+' · '+s.name:s.name+(s.date?' · '+s.date:''))+'</option>';
  }).join('');
  var a=active();
  // Senaste först: oftast vill man utgå från förra matchen eller träningen.
  $('copyFrom').innerHTML='<option value="">Hämta från…</option>'+S.sets.filter(function(s){return s.id!==a.id&&placed(s);})
    .sort(function(x,y){return (x.date||'')<(y.date||'')?1:(x.date||'')>(y.date||'')?-1:0;}).map(function(s){
      var x=actOf(s);
      return '<option value="'+esc(s.id)+'">'+esc((x?whenOf(x)+' · '+s.name:s.name+(s.date?' · '+s.date:''))+' ('+placed(s)+' platser)')+'</option>';
    }).join('');
  $('copyFrom').disabled=$('copyFrom').options.length<2;
  $('setName').value=a.name;
  $('setDate').value=a.date||'';
}

function renderLink(){
  var a=active(),t=today(),x=actOf(a);
  $('actInfo').hidden=!x;$('unlinkAct').hidden=!x;$('setAct').hidden=!!x;
  if(x){
    $('actInfo').innerHTML='<span class="k">'+esc(TYPE[x.type]||'Övrigt')+'</span>'+esc(whenOf(x)+' · '+x.title);
    $('actInfo').title=x.title+(x.location?' · '+x.location:'');
  }else{
    var list=S.activities.filter(function(y){return dayOf(y)>=t&&!setFor(y.id);}).sort(byStart);
    $('setAct').innerHTML='<option value="">Ingen — koppla till en aktivitet…</option>'+list.map(function(y){
      return '<option value="'+esc(y.id)+'">'+esc(whenOf(y)+' · '+y.title)+'</option>';
    }).join('');
  }
  $('attSum').innerHTML=x&&x.attending&&x.attending.length?attSummary(x.attending):'';
}

function card(x,past){
  var s=setFor(x.id),d=dayOf(x);
  var att=x.attending&&x.attending.length?attSummary(x.attending):'Ingen närvaro inläst';
  return '<article class="act" data-id="'+esc(x.id)+'" data-type="'+esc(x.type)+'"'+(x.cancelled?' data-cancelled="1"':'')+(past?' data-past="1"':'')+'>'+
    '<div class="when"><span class="wd">'+esc(fmtDay(d,{weekday:'short'}))+'</span><span class="d">'+esc(fmtDay(d,{day:'numeric'}))+'</span><span class="t">'+esc(timeOf(x))+'</span></div>'+
    '<div class="what"><span class="type">'+(x.cancelled?'Inställd · ':'')+esc(TYPE[x.type]||'Övrigt')+'</span><h3>'+esc(x.title)+'</h3>'+
      (x.location?'<p>'+esc(x.location)+'</p>':'')+'<p class="att">'+att+'</p>'+
      (s?'<p>Uppställning: '+placed(s)+' av '+slotsOf(s)+' platser fyllda</p>':'')+'</div>'+
    '<div class="ops"><button class="btn'+(s?'':' primary')+'" data-op="lineup">'+(s?'Öppna uppställning':'Bygg uppställning')+'</button>'+
      '<button class="btn" data-op="att">Närvaro</button>'+
      '<button class="x" data-op="del" aria-label="Ta bort aktiviteten '+esc(x.title)+'" title="Ta bort">×</button></div>'+
  '</article>';
}

function renderActs(){
  var t=today(),showPast=$('showPast').checked;
  var up=S.activities.filter(function(x){return dayOf(x)>=t;}).sort(byStart);
  var old=S.activities.filter(function(x){return dayOf(x)<t;}).sort(byStart).reverse();
  $('actCount').textContent=up.length+' kommande';
  var cal=S.team&&S.team.cal,fi=$('feedInfo');
  $('syncBtn').hidden=!cal;
  $('importBtn').textContent=cal?'Byt kalender':'Hämta kalender';
  $('importBtn').classList.toggle('primary',!cal);
  fi.dataset.err=feedErr?'1':'0';
  if(!cal)fi.textContent='';
  else if(feedBusy)fi.textContent='Hämtar kalendern från '+hostOf(cal)+'…';
  else if(feedErr)fi.textContent='Kunde inte hämta kalendern just nu — visar det som hämtades senast.';
  else if(S.feedAt){var a=new Date(S.feedAt);fi.textContent='Hämtas automatiskt från '+hostOf(cal)+' — senast '+fmtDay(a.getFullYear()+'-'+pad(a.getMonth()+1)+'-'+pad(a.getDate()),{weekday:'short',day:'numeric',month:'short'})+' '+pad(a.getHours())+':'+pad(a.getMinutes())+'.';}
  else fi.textContent='Hämtas automatiskt från '+hostOf(cal)+'.';
  $('tabCount').textContent=up.length?'('+up.length+')':'';
  var el=$('actList');
  if(!S.activities.length){
    el.innerHTML='<div class="emptystate"><h3>Inga aktiviteter än</h3><p>Tryck på <b>Hämta kalender</b> och klistra in länken till lagets kalender eller hemsida, så dyker kommande matcher och träningar upp här. Därifrån bygger du uppställningen med ett klick, och klistrar in vilka som anmält sig.</p></div>';
    return;
  }
  var html='',month='';
  up.forEach(function(x){
    var m=fmtDay(dayOf(x),{month:'long',year:'numeric'});
    if(m!==month){html+='<h3 class="month">'+esc(m)+'</h3>';month=m;}
    html+=card(x,false);
  });
  if(!up.length)html+='<p class="muted">Inga kommande aktiviteter. Importera ett nyare kalenderflöde.</p>';
  if(showPast&&old.length){html+='<h3 class="month">Passerade</h3>'+old.map(function(x){return card(x,true);}).join('');}
  el.innerHTML=html;
}

function renderView(){
  var acts=S.view==='acts';
  $('viewLineup').hidden=acts;$('viewActs').hidden=!acts;$('setbar').hidden=acts;
  $('tabLineup').setAttribute('aria-selected',String(!acts));
  $('tabActs').setAttribute('aria-selected',String(acts));
}

function render(){
  ensureUnits(active());
  renderView();renderBench();renderUnits();renderChecks();renderSets();renderLink();renderActs();renderBackup();
}

/* ---------- drag & tryck ---------- */
var drag=null,timer=null,ghost=null,lastDrop=null;

function pidFrom(el){var c=el.closest('.chip,.slot[data-filled="1"]');return c?c.dataset.pid:null;}
function fromOf(el){var s=el.closest('.slot[data-filled="1"]');return s?{u:s.dataset.u,i:+s.dataset.i}:null;}

document.addEventListener('pointerdown',function(e){
  if(e.button===1||e.button===2)return;
  if(e.target.closest('.x'))return;
  var host=e.target.closest('.chip,.slot');
  if(!host)return;
  var pid=pidFrom(e.target);
  if(!pid)return;
  var p=P(pid); if(!p)return;
  drag={pid:pid,from:fromOf(e.target),x:e.clientX,y:e.clientY,on:false,id:e.pointerId,touch:e.pointerType==='touch',t:Date.now()};
  if(drag.touch){timer=setTimeout(function(){start(e.clientX,e.clientY);},190);}
},{passive:true});

function start(x,y){
  if(!drag||drag.on)return;
  drag.on=true;
  var p=P(drag.pid);
  ghost=chip(p);ghost.classList.add('dragghost');
  document.body.appendChild(ghost);
  moveGhost(x,y);
  if(navigator.vibrate)try{navigator.vibrate(8);}catch(e){}
}
function moveGhost(x,y){if(ghost){ghost.style.left=x+'px';ghost.style.top=y+'px';}}

document.addEventListener('pointermove',function(e){
  if(!drag||e.pointerId!==drag.id)return;
  var d=Math.abs(e.clientX-drag.x)+Math.abs(e.clientY-drag.y);
  if(!drag.on){
    if(drag.touch){if(d>12){clearTimeout(timer);drag=null;}return;}
    if(d>5)start(e.clientX,e.clientY); else return;
  }
  moveGhost(e.clientX,e.clientY);
  var el=document.elementFromPoint(e.clientX,e.clientY);
  var t=el?(el.closest('.slot')||el.closest('.bench')):null;
  if(t!==lastDrop){
    if(lastDrop)lastDrop.classList.remove('drop');
    if(t)t.classList.add('drop');
    lastDrop=t;
  }
},{passive:true});

document.addEventListener('touchmove',function(e){if(drag&&drag.on)e.preventDefault();},{passive:false});

document.addEventListener('pointerup',function(e){
  if(!drag||e.pointerId!==drag.id)return;
  clearTimeout(timer);
  if(lastDrop)lastDrop.classList.remove('drop');
  if(drag.on){
    if(ghost){ghost.remove();ghost=null;}
    var el=document.elementFromPoint(e.clientX,e.clientY);
    var slot=el?el.closest('.slot'):null;
    var bn=el?el.closest('.bench'):null;
    if(slot)place(drag.pid,slot.dataset.u,+slot.dataset.i,drag.from);
    else if(bn&&drag.from)clearSlot(drag.from.u,drag.from.i);
    else render();
  }else{
    tap(drag.pid,drag.from,e.target);
  }
  drag=null;lastDrop=null;
},{passive:true});

document.addEventListener('pointercancel',function(){
  clearTimeout(timer);
  if(ghost){ghost.remove();ghost=null;}
  if(lastDrop)lastDrop.classList.remove('drop');
  drag=null;lastDrop=null;
},{passive:true});

function tap(pid,from,target){
  var slot=target.closest('.slot');
  if(sel&&sel!==pid&&slot){place(sel,slot.dataset.u,+slot.dataset.i,selFrom);sel=null;selFrom=null;return;}
  if(sel===pid){sel=null;selFrom=null;}
  else{sel=pid;selFrom=from;say(P(pid).name+' vald — tryck på en ruta för att placera.');}
  render();
}

// tom ruta: placera vald spelare
document.addEventListener('click',function(e){
  var slot=e.target.closest('.slot');
  if(!slot||e.target.closest('.x'))return;
  if(slot.dataset.filled==='1')return;
  if(sel){place(sel,slot.dataset.u,+slot.dataset.i,selFrom);sel=null;selFrom=null;}
});
document.addEventListener('keydown',function(e){
  if(e.key!=='Enter'&&e.key!==' ')return;
  var host=e.target.closest('.chip,.slot');if(!host)return;
  e.preventDefault();
  if(host.classList.contains('slot')&&host.dataset.filled!=='1'){
    if(sel){place(sel,host.dataset.u,+host.dataset.i,selFrom);sel=null;selFrom=null;}
    return;
  }
  tap(host.dataset.pid,fromOf(host),host);
});

/* ---------- knappar ---------- */
function say(m){
  $('live').textContent=m;
  var t=document.querySelector('.toast');if(t)t.remove();
  var d=document.createElement('div');d.className='toast';d.textContent=m;document.body.appendChild(d);
  setTimeout(function(){d.remove();},2600);
}

$('addBtn').addEventListener('click',function(){
  var n=$('addName').value.trim();
  if(!n){$('addName').focus();return;}
  S.roster.push({id:uid(),num:$('addNum').value.trim()||'–',name:n,pos:$('addPos').value});
  $('addName').value='';$('addNum').value='';
  $('addNum').focus();save();render();
});
$('addName').addEventListener('keydown',function(e){if(e.key==='Enter')$('addBtn').click();});

// Kopierar bara placeringarna. Uppställningen behåller sin egen aktivitet, närvaro, färger och läge.
$('copyFrom').addEventListener('change',function(e){
  var src=null,a=active(),id=e.target.value;e.target.value='';
  S.sets.forEach(function(s){if(s.id===id)src=s;});
  if(!src)return;
  if(placed(a)&&!confirm('Ersätta de '+placed(a)+' placeringarna i "'+a.name+'" med uppställningen från "'+src.name+'"?'))return;
  // Har källan fler femmor/PP/BP/målvakter än målet utökas målet, så att inget faller bort.
  a.count=a.count||{};
  Object.keys(BASE).forEach(function(g){if(countOf(src,g)>countOf(a,g))a.count[g]=countOf(src,g);});
  a.units={};
  unitsOf(a).forEach(function(u){a.units[u.k]=(src.units[u.k]||[]).slice(0,u.slots.length);});
  ensureUnits(a);
  sel=null;save();render();
  var away=S.roster.filter(function(p){return a.off[p.id]&&loadOf(p.id)>0;}).length;
  say('Uppställningen hämtad från "'+src.name+'".'+(away?' '+away+' av spelarna är frånvarande — se Kontroll.':''));
});
$('clearLines').addEventListener('click',function(){resetUnits(active());sel=null;save();render();});
$('unitBar').addEventListener('click',function(e){var b=e.target.closest('[data-add]');if(b)addUnit(b.dataset.add);});

$('autoFill').addEventListener('click',function(){
  var a=active(),L=a.units,EV=evKeys(a);
  var used={};EV.forEach(function(k){L[k].forEach(function(x){if(x)used[x]=1;});});
  var fw=[],bk=[],gk=[];
  S.roster.forEach(function(p){if(isOff(p)||used[p.id])return;
    if(p.pos==='F')fw.push(p.id);else if(p.pos==='B')bk.push(p.id);else if(L.GK.indexOf(p.id)<0)gk.push(p.id);});
  EV.forEach(function(k){
    [0,1,2].forEach(function(i){if(!L[k][i]&&fw.length)L[k][i]=fw.shift();});
    [3,4].forEach(function(i){if(!L[k][i]&&bk.length)L[k][i]=bk.shift();});
  });
  L.GK.forEach(function(x,i){if(!x&&gk.length)L.GK[i]=gk.shift();});
  save();render();say('Femmorna fyllda med tillgängliga spelare.');
});

/* ---------- export: träning (västfärger) och match ---------- */
var exp={mode:'match'};

// Gemensamt urval för bild och text: vilka kort som ska med, i vilken ordning, med vilka färger.
function buildCards(s,mode,o){
  var L=s.units,cards=[],cols=colorsOf(s);
  function rows(u){return u.slots.map(function(r,i){
    var p=L[u.k][i]?P(L[u.k][i]):null;
    return {role:r,num:p&&p.num!=='–'?p.num:'',name:p?p.name:'—',empty:!p};
  });}
  unitsOf(s).forEach(function(u){
    if(!L[u.k].some(Boolean))return;
    if((u.grp==='pp'||u.grp==='bp')&&!o.st)return;
    if((u.grp==='ot'||u.grp==='forc')&&!o.extra)return;
    if(u.grp==='ev'&&mode==='traning'){
      var v=vest(cols[u.k]);
      // På träning heter femman bara sin färg — "Femma 1" ger intryck av en rangordning.
      cards.push({title:v.name,band:v.hex,ink:v.ink,rows:rows(u),vest:true});
    }else{
      var rs=rows(u);
      // Start/back-up spelar ingen roll på träning.
      if(u.grp==='gk'&&mode==='traning')rs.forEach(function(r){r.role='';});
      cards.push({title:u.name,band:GRPC[u.grp],ink:'#fff',rows:rs});
    }
  });
  if(mode==='traning'&&o.rest){
    var used={};
    evKeys(s).concat('GK').forEach(function(k){L[k].forEach(function(id){if(id)used[id]=1;});});
    var rest=S.roster.filter(function(p){return !s.off[p.id]&&!used[p.id];});
    if(rest.length)cards.push({title:'Övriga som kommer',band:'#5b7083',ink:'#fff',
      rows:rest.map(function(p){return {role:p.pos,num:p.num!=='–'?p.num:'',name:p.name};})});
  }
  return cards;
}

function headOf(s,mode){
  var x=actOf(s),title=(x?x.title:s.name)||'Uppställning';
  // "Match: X", "Match X", "Träning - X" → "X"
  title=title.replace(/^(match|träning)(\s*[:\-–]\s*|\s+)/i,'')||title;
  var d=x?dayOf(x):s.date,sub=[];
  if(d){var w=fmtDay(d,{weekday:'long',day:'numeric',month:'long'});sub.push(w.charAt(0).toUpperCase()+w.slice(1));}
  // Samlingstid från laget.se visas före starttiden när den skiljer sig.
  var gt=x&&x.gather&&/T(\d{2}:\d{2})/.exec(x.gather);
  if(gt&&timeOf(x)&&gt[1]!==timeOf(x))sub.push('Samling '+gt[1]);
  if(x&&timeOf(x))sub.push((gt&&gt[1]!==timeOf(x)?'Start ':'')+timeOf(x));
  if(x&&x.location)sub.push(x.location);
  return {label:mode==='traning'?'Träning':'Match',title:title,sub:sub.join('  ·  ')};
}

function sheetText(s,mode,o){
  var h=headOf(s,mode),out=[h.label.toUpperCase()+': '+h.title];
  if(h.sub)out.push(h.sub);
  out.push('');
  buildCards(s,mode,o).forEach(function(c){
    out.push(c.title.toUpperCase()+(c.tag?' — '+c.tag.toUpperCase():''));
    c.rows.forEach(function(r){out.push('  '+(r.role+'     ').slice(0,6)+(r.num?'#'+r.num+' ':'')+r.name);});
    out.push('');
  });
  return out.join('\n').trim();
}

function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function fit(g,t,w){t=String(t);if(g.measureText(t).width<=w)return t;while(t.length>1&&g.measureText(t+'…').width>w)t=t.slice(0,-1);return t+'…';}
function spacing(g,px){if('letterSpacing' in g)g.letterSpacing=px+'px';}
// Lagets logga (S.team.logo, data-URI) laddas när laget sparas; exporten väntar på den så att första bilden inte blir utan logga.
var logoImg=null,logoReady=Promise.resolve();
function setLogo(src){
  if(!src){logoImg=null;logoReady=Promise.resolve();return;}
  var im=new Image();
  logoReady=new Promise(function(res){im.onload=function(){logoImg=im;res();};im.onerror=function(){logoImg=null;res();};});
  im.src=src;
}
var DF='"Barlow Condensed","Arial Narrow",Arial,sans-serif',BF='Barlow,"Helvetica Neue",Arial,sans-serif';

// Titeln ska alltid synas hel: först krymps den på en rad (66→46 px), sedan delas den på två rader vid det
// ordbyte som ger jämnast rader (60→34 px). Bara som sista utväg kortas den med "…".
function titleLayout(g,t,w){
  var s,words=t.split(' ');
  for(s=66;s>=46;s-=2){g.font='700 '+s+'px '+DF;if(g.measureText(t).width<=w)return {size:s,lines:[t]};}
  for(s=60;s>=34;s-=2){
    g.font='700 '+s+'px '+DF;
    var best=null;
    for(var i=1;i<words.length;i++){
      var a=words.slice(0,i).join(' '),b=words.slice(i).join(' '),m=Math.max(g.measureText(a).width,g.measureText(b).width);
      if(!best||m<best.m)best={m:m,lines:[a,b]};
    }
    if(best&&best.m<=w)return {size:s,lines:best.lines};
  }
  return {size:34,lines:best?best.lines:[t]};
}

// Ritar uppställningen som en 1080 px bred bild. Korten läggs i två kolumner, alltid i den kortaste.
function drawSheet(s,mode,o){
  var cards=buildCards(s,mode,o),h=headOf(s,mode);
  var W=1080,PD=44,G=22,CW=(W-PD*2-G)/2,BH=60,RH=50,CP=10;
  // Rubrikens textyta: bredden minus loggan (fast höjd 150 px).
  var LH=150,LW=logoImg&&logoImg.naturalWidth?LH*logoImg.naturalWidth/logoImg.naturalHeight:0;
  var TW=W-PD*2-(LW?LW+28:0);
  var T=titleLayout(document.createElement('canvas').getContext('2d'),h.title.toUpperCase(),TW);
  var tY=[],yy=72+12;
  T.lines.forEach(function(l,i){yy+=i?T.size*.98:T.size*.9;tY.push(yy);});
  var subY=yy+50,HH=Math.max((h.sub?subY:yy)+44,LH+56);
  function ch(c){return BH+CP*2+c.rows.length*RH;}
  var top=HH+10+PD,col=[top,top],pos=[];
  cards.forEach(function(c){var i=col[0]<=col[1]?0:1;pos.push([PD+i*(CW+G),col[i]]);col[i]+=ch(c)+G;});
  var H=(cards.length?Math.max(col[0],col[1])-G:top+120)+PD+34;
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var g=cv.getContext('2d');
  g.fillStyle='#eef3f7';g.fillRect(0,0,W,H);

  // rubrik
  g.fillStyle='#0d1d2b';g.fillRect(0,0,W,HH);
  g.textBaseline='alphabetic';
  if(LW)g.drawImage(logoImg,W-PD-LW,(HH-LH)/2,LW,LH);
  g.fillStyle=mode==='traning'?'#4cc38a':'#59a3e8';
  g.font='700 28px '+DF;spacing(g,4);g.fillText(h.label.toUpperCase(),PD,72);spacing(g,0);
  g.fillStyle='#ffffff';g.font='700 '+T.size+'px '+DF;
  T.lines.forEach(function(l,i){g.fillText(fit(g,l,TW),PD,tY[i]);});
  if(h.sub){
    g.fillStyle='#a9bccd';
    for(var ss=30;ss>20;ss--){g.font='500 '+ss+'px '+BF;if(g.measureText(h.sub).width<=TW)break;}
    g.fillText(fit(g,h.sub,TW),PD,subY);
  }
  // rand under rubriken: västfärgerna på träning, accentfärg på match
  var stripe=mode==='traning'?cards.filter(function(c){return c.vest;}).map(function(c){return c.band;}):[];
  if(!stripe.length)stripe=['#59a3e8'];
  stripe.forEach(function(c,i){g.fillStyle=c;g.fillRect(i*W/stripe.length,HH,Math.ceil(W/stripe.length),10);});

  if(!cards.length){g.fillStyle='#5b7083';g.font='500 32px '+BF;g.fillText('Uppställningen är tom.',PD,top+60);}

  cards.forEach(function(c,ci){
    var x=pos[ci][0],y=pos[ci][1],hh=ch(c);
    g.save();
    g.shadowColor='rgba(13,29,43,.10)';g.shadowBlur=14;g.shadowOffsetY=3;
    g.fillStyle='#ffffff';rr(g,x,y,CW,hh,12);g.fill();
    g.restore();
    g.save();rr(g,x,y,CW,hh,12);g.clip();
    g.fillStyle=c.band;g.fillRect(x,y,CW,BH);
    if(c.vest&&c.band!=='#ffffff'){g.globalAlpha=.07;g.fillRect(x,y+BH,CW,hh-BH);g.globalAlpha=1;}
    g.restore();
    g.strokeStyle='#d3dee8';g.lineWidth=2;rr(g,x+1,y+1,CW-2,hh-2,11);g.stroke();
    if(c.band==='#ffffff'){g.beginPath();g.moveTo(x,y+BH);g.lineTo(x+CW,y+BH);g.stroke();}
    g.fillStyle=c.ink;g.font='700 30px '+DF;spacing(g,2);
    g.fillText(c.title.toUpperCase(),x+20,y+40);
    if(c.tag){g.textAlign='right';g.font='700 26px '+DF;g.fillText(c.tag.toUpperCase(),x+CW-20,y+40);g.textAlign='left';}
    spacing(g,0);
    c.rows.forEach(function(r,i){
      var ry=y+BH+CP+i*RH,mid=ry+RH/2+10;
      if(i){g.strokeStyle='#e6edf3';g.lineWidth=1.5;g.beginPath();g.moveTo(x+18,ry);g.lineTo(x+CW-18,ry);g.stroke();}
      g.fillStyle='#7b8fa2';spacing(g,1);
      for(var fs=21;fs>12;fs--){g.font='600 '+fs+'px '+DF;if(g.measureText(r.role).width<=60)break;}
      g.fillText(r.role,x+20,mid);spacing(g,0);
      g.textAlign='right';g.fillStyle='#0d1d2b';g.font='700 30px '+DF;g.fillText(r.num,x+118,mid);g.textAlign='left';
      g.fillStyle=r.empty?'#a7b5c2':'#0d1d2b';g.font=(r.empty?'400 ':'500 ')+'28px '+BF;
      g.fillText(fit(g,r.name,CW-150),x+132,mid);
    });
  });
  g.fillStyle='#8a9bab';g.font='500 20px '+BF;g.fillText('Kedjebygget',PD,H-26);
  return cv;
}

function expOpts(){
  S.expOpt=S.expOpt||{match:{st:true,extra:true,rest:false},traning:{st:true,extra:false,rest:true}};
  return S.expOpt[exp.mode];
}
function renderExp(){
  var s=active(),o=expOpts(),tr=exp.mode==='traning';
  ensureUnits(s);
  [].forEach.call(document.querySelectorAll('#expDlg .seg button'),function(b){b.setAttribute('aria-checked',String(b.dataset.mode===exp.mode));});
  $('expST').checked=o.st;$('expExtra').checked=o.extra;$('expRest').checked=o.rest;$('expRestWrap').hidden=!tr;
  $('expExtra').closest('label').hidden=tr; // övertid och forcering finns inte på träning
  var cols=colorsOf(s);
  $('expColors').innerHTML=tr?evKeys(s).map(function(k){
    var nm=unitDef(s,k).name;
    return '<div class="colrow"><b>'+esc(nm)+' — '+esc(vest(cols[k]).name)+'</b><div class="swatches">'+VEST.map(function(v){
      return '<button type="button" class="sw" data-k="'+k+'" data-c="'+v.id+'" style="--v:'+v.hex+'" aria-pressed="'+(cols[k]===v.id)+'" title="'+v.name+'" aria-label="'+esc(nm)+': '+v.name+'"></button>';
    }).join('')+'</div></div>';
  }).join(''):'';
  var draw=function(){exp.canvas=drawSheet(s,exp.mode,o);$('expImg').src=exp.canvas.toDataURL('image/png');};
  // Typsnitten måste vara laddade innan de kan användas på canvas.
  if(document.fonts&&document.fonts.load){
    Promise.all([document.fonts.load('700 30px "Barlow Condensed"'),document.fonts.load('500 28px Barlow'),logoReady]).then(draw,draw);
  }else logoReady.then(draw);
}
function expFile(cb){
  var s=active(),name=(headOf(s,exp.mode).title+' '+(s.date||'')).trim().replace(/[^\wåäöÅÄÖ\- ]+/g,'').replace(/\s+/g,'-').toLowerCase()||'uppstallning';
  exp.canvas.toBlob(function(b){cb(b,name+'.png');},'image/png');
}

$('exportBtn').addEventListener('click',function(){
  exp.mode=modeOf(active());renderExp();
  var d=$('expDlg');if(d.showModal)d.showModal();else d.setAttribute('open','');
  var probe=new File([''],'a.png',{type:'image/png'});
  $('expShare').hidden=!(navigator.canShare&&navigator.canShare({files:[probe]}));
});
[].forEach.call(document.querySelectorAll('#expDlg .seg button'),function(b){
  b.addEventListener('click',function(){exp.mode=b.dataset.mode;active().mode=exp.mode;save();renderExp();renderUnits();});
});
$('expColors').addEventListener('click',function(e){
  var b=e.target.closest('.sw');if(!b)return;
  setColor(b.dataset.k,b.dataset.c);renderExp();renderUnits();
});
['expST','expExtra','expRest'].forEach(function(id){
  $(id).addEventListener('change',function(){var o=expOpts();o.st=$('expST').checked;o.extra=$('expExtra').checked;o.rest=$('expRest').checked;save();renderExp();});
});
$('expSave').addEventListener('click',function(){
  expFile(function(b,n){
    var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
    say('Bilden sparad i Hämtade filer.');
  });
});
$('expShare').addEventListener('click',function(){
  expFile(function(b,n){
    var f=new File([b],n,{type:'image/png'});
    navigator.share({files:[f],title:headOf(active(),exp.mode).title}).catch(function(){});
  });
});
$('expCopy').addEventListener('click',function(){
  if(!(navigator.clipboard&&window.ClipboardItem)){say('Webbläsaren kan inte kopiera bilder — använd Ladda ner bild.');return;}
  expFile(function(b){
    navigator.clipboard.write([new ClipboardItem({'image/png':b})]).then(function(){say('Bilden kopierad — klistra in i chatten.');},
      function(){say('Kunde inte kopiera bilden — använd Ladda ner bild.');});
  });
});
$('expText').addEventListener('click',function(){
  var txt=sheetText(active(),exp.mode,expOpts());
  var done=function(){say('Texten kopierad.');};
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(done,function(){fallback(txt);});
  }else fallback(txt);
});
$('expPrint').addEventListener('click',function(){
  $('printImg').src=exp.canvas.toDataURL('image/png');
  setTimeout(function(){window.print();},60);
});
function fallback(txt){
  var ta=document.createElement('textarea');
  ta.value=txt;ta.style.cssText='position:fixed;left:16px;right:16px;bottom:70px;height:40vh;z-index:130;font:13px monospace;padding:10px';
  document.body.appendChild(ta);ta.select();
  say('Markera texten och kopiera.');
  ta.addEventListener('blur',function(){ta.remove();});
}

$('setPick').addEventListener('change',function(e){S.active=e.target.value;sel=null;save();render();});
$('setName').addEventListener('input',function(e){active().name=e.target.value;save();renderSets();});
$('setDate').addEventListener('input',function(e){active().date=e.target.value;save();renderSets();});
$('newSet').addEventListener('click',function(){
  var s=newSet('Ny uppställning');S.sets.push(s);S.active=s.id;save();render();
  $('setName').select();
});
$('dupSet').addEventListener('click',function(){
  var a=active(),s=newSet(a.name+' (kopia)',a.date);
  s.units=JSON.parse(JSON.stringify(a.units));if(a.count)s.count=JSON.parse(JSON.stringify(a.count));
  for(var k in a.off)s.off[k]=true;
  if(a.colors)s.colors=JSON.parse(JSON.stringify(a.colors));
  if(a.mode)s.mode=a.mode;
  S.sets.push(s);S.active=s.id;save();render();
});
$('delSet').addEventListener('click',function(){
  var a=active();
  if(!confirm(S.sets.length<2?'Tömma "'+a.name+'"?':'Ta bort uppställningen "'+a.name+'"?'))return;
  if(S.sets.length<2){resetUnits(a);save();render();return;}
  S.sets=S.sets.filter(function(s){return s.id!==S.active;});
  S.active=S.sets[0].id;save();render();
});

/* ---------- flikar och aktiviteter ---------- */
[$('tabLineup'),$('tabActs')].forEach(function(b){
  b.addEventListener('click',function(){S.view=b.dataset.view;sel=null;save();render();});
});
$('showPast').addEventListener('change',renderActs);
$('importBtn').addEventListener('click',openCal);
$('syncBtn').addEventListener('click',function(){sync(false);});
$('icsFile').addEventListener('change',function(){
  var f=this.files&&this.files[0];if(!f)return;
  var r=new FileReader();
  r.onload=function(){importText(String(r.result),f.name);};
  r.onerror=function(){say('Kunde inte läsa '+f.name+'.');};
  r.readAsText(f);
  this.value='';
});
$('actList').addEventListener('click',function(e){
  var b=e.target.closest('[data-op]');if(!b)return;
  var id=b.closest('.act').dataset.id,x=actById(id);if(!x)return;
  if(b.dataset.op==='lineup')openLineup(id);
  else if(b.dataset.op==='att')openAtt(x,setFor(id));
  else if(b.dataset.op==='del'){
    if(!confirm('Ta bort "'+x.title+'"? Kopplade uppställningar ligger kvar.'))return;
    S.activities=S.activities.filter(function(y){return y.id!==id;});
    S.sets.forEach(function(s){if(s.activityId===id)delete s.activityId;});
    save();render();
  }
});
$('setAct').addEventListener('change',function(e){linkSet(e.target.value);});
$('unlinkAct').addEventListener('click',function(){
  var a=active(),x=actOf(a);if(!x)return;
  if(!confirm('Koppla loss uppställningen från "'+x.title+'"? Uppställningen och närvaron finns kvar, men hänger inte längre ihop.'))return;
  delete a.activityId;save();render();
});
$('attOpen').addEventListener('click',function(){var a=active();openAtt(actOf(a),a);});

/* ---------- närvarodialog ---------- */
var dlg=$('attDlg'),att={act:null,set:null,rows:[]},attTimer=null;

function openAtt(x,set){
  att.act=x;att.set=set;
  $('attFor').textContent=x?x.title+' · '+fmtDay(dayOf(x),{day:'numeric',month:'short'}):set.name;
  $('attStrict').checked=x?x.strict!==false:true;
  var prev=x&&x.attending?x.attending:[];
  // Sparade kopplingar och statusar räknas som manuella så att de överlever en omtolkning av texten.
  att.rows=prev.map(function(e){return {name:e.name,status:e.status,comment:e.comment||'',pid:e.pid&&P(e.pid)?e.pid:null,manual:!!e.pid,stManual:true};});
  $('attText').value=prev.map(function(e){return e.name+' - '+WORD[e.status];}).join('\n');
  reparse();
  if(dlg.showModal)dlg.showModal();else dlg.setAttribute('open','');
  if(!prev.length)$('attText').focus();
}

function reparse(){
  var parsed=parseAttendance($('attText').value),prev={};
  att.rows.forEach(function(r){prev[norm(r.name)]=r;});
  var m=matchNames(parsed.map(function(e){return e.name;}));
  att.rows=parsed.map(function(e,i){
    var p=prev[norm(e.name)];
    return {name:e.name,comment:e.comment||(p&&p.comment)||'',status:p&&p.stManual?p.status:e.status,stManual:!!(p&&p.stManual),
      pid:p&&p.manual?p.pid:m[i].pid,manual:!!(p&&p.manual),cands:m[i].cands};
  });
  // en manuell koppling vinner över en automatisk till samma spelare
  var taken={};
  att.rows.forEach(function(r){if(r.manual&&r.pid)taken[r.pid]=1;});
  att.rows.forEach(function(r){if(!r.manual&&r.pid&&taken[r.pid])r.pid=null;});
  renderReview();
}

function renderReview(){
  var el=$('attReview'),rows=att.rows;
  if(!rows.length){el.innerHTML='';return;}
  var linked={},miss=0;
  rows.forEach(function(r){if(r.pid&&r.pid!=='__new')linked[r.pid]=1;else if(!r.pid)miss++;});
  var absent=S.roster.filter(function(p){return !linked[p.id];});
  var html='<p class="rvsum">'+attSummary(rows)+'. <b>'+(rows.length-miss)+' av '+rows.length+'</b> kopplade till truppen'+
    (miss?' — <span class="warn">'+miss+' saknar koppling</span>, välj spelare nedan':'')+'.</p><div class="rv">';
  rows.forEach(function(r,i){
    var order=(r.cands&&r.cands.length?r.cands:S.roster.map(function(p){return p.id;}));
    html+='<div class="rvrow" data-i="'+i+'"'+(r.pid?'':' data-miss="1"')+'><span class="rn" title="'+esc(r.name)+'">'+esc(r.name)+(r.comment?'<small>'+esc(r.comment)+'</small>':'')+'</span>'+
      '<select data-f="status" aria-label="Status för '+esc(r.name)+'">'+['ja','nej','ej_svarat'].map(function(s){
        return '<option value="'+s+'"'+(r.status===s?' selected':'')+'>'+WORD[s]+'</option>';}).join('')+'</select>'+
      '<select data-f="pid" aria-label="Spelare för '+esc(r.name)+'"><option value="">Ingen koppling</option>'+
      '<option value="__new"'+(r.pid==='__new'?' selected':'')+'>+ Lägg till i truppen</option>'+
      order.map(function(id){var p=P(id);if(!p)return '';
        return '<option value="'+esc(id)+'"'+(r.pid===id?' selected':'')+'>'+esc(p.num+' '+p.name)+'</option>';}).join('')+
      '</select></div>';
  });
  html+='</div>';
  if(absent.length&&absent.length<S.roster.length)html+='<p class="rvsum">Inte med i listan: '+absent.map(function(p){return esc(p.name);}).join(', ')+'.</p>';
  el.innerHTML=html;
}

$('attText').addEventListener('input',function(){clearTimeout(attTimer);attTimer=setTimeout(reparse,220);});
$('attReview').addEventListener('change',function(e){
  var s=e.target.closest('select');if(!s)return;
  var r=att.rows[+s.closest('.rvrow').dataset.i];if(!r)return;
  if(s.dataset.f==='status'){r.status=s.value;r.stManual=true;}
  else{
    r.pid=s.value||null;r.manual=true;
    if(r.pid&&r.pid!=='__new')att.rows.forEach(function(o){if(o!==r&&o.pid===r.pid){o.pid=null;o.manual=false;}});
  }
  renderReview();
});
$('attSave').addEventListener('click',function(){
  clearTimeout(attTimer);
  if($('attText').value.trim()&&!att.rows.length){say('Hittade inga namn i listan.');return;}
  var strict=$('attStrict').checked;
  att.rows.forEach(function(r){
    if(r.pid==='__new'){var p={id:uid(),num:'–',name:r.name,pos:'F',lagetId:norm(r.name)};S.roster.push(p);r.pid=p.id;}
    else if(r.pid&&r.manual){var q=P(r.pid);if(q)q.lagetId=norm(r.name);}
  });
  var entries=att.rows.map(function(r){return {name:r.name,status:r.status,comment:r.comment||'',pid:r.pid||null};});
  if(att.act){att.act.attending=entries;att.act.strict=strict;applyAtt(att.act);}
  if(att.set&&(!att.act||att.set.activityId!==att.act.id))att.set.off=entries.length?offFrom(entries,strict):{};
  save();
  if(dlg.close)dlg.close();else dlg.removeAttribute('open');
  render();
  var c=entries.filter(function(e){return e.status==='ja';}).length;
  say('Närvaro sparad — '+c+' kommer.');
});

/* ---------- redigera trupp ---------- */
$('editRoster').addEventListener('click',function(){editing=!editing;sel=null;render();});

/* ---------- backup ---------- */
// Hela S sparas som en JSON-fil. Påminnelsen blir röd när senaste backup är äldre än en vecka.
function renderBackup(){
  var el=$('backupInfo'),t=S.backupAt;
  if(!t){el.textContent='Ingen backup sparad än — allt finns bara i den här webbläsaren.';el.dataset.stale='1';return;}
  var days=Math.floor((Date.now()-new Date(t).getTime())/864e5);
  el.textContent='Senaste backup: '+(days<1?'i dag':days===1?'i går':days+' dagar sedan')+'.';
  el.dataset.stale=days>7?'1':'0';
}
$('backupSave').addEventListener('click',function(){
  S.backupAt=new Date().toISOString();
  var blob=new Blob([JSON.stringify(S,null,1)],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='kedjebygget-backup-'+today()+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(a.href);},1000);
  save();renderBackup();say('Backup sparad i Hämtade filer.');
});
$('backupLoad').addEventListener('click',function(){$('backupFile').click();});
$('backupFile').addEventListener('change',function(){
  var f=this.files&&this.files[0];if(!f)return;this.value='';
  var r=new FileReader();
  r.onload=function(){
    var p=null;try{p=JSON.parse(String(r.result));}catch(e){}
    if(!p||!Array.isArray(p.roster)||!Array.isArray(p.sets)||!p.sets.length){say(f.name+' är ingen backup från Kedjebygget.');return;}
    if(!confirm('Ersätta allt här med backupen ('+p.roster.length+' spelare, '+p.sets.length+' uppställningar)? Det som finns nu skrivs över.'))return;
    S=p;migrate();
    if(!active())S.active=S.sets[0].id;
    sel=null;editing=false;save();applyTeam();render();say('Backup inläst.');
  };
  r.readAsText(f);
});

/* ---------- laget ---------- */
// S.team = {name, logo (data-URI), cal (https-länk till .ics)}. Saknas laget visas dialogen vid start.
// webcal:// blir https://, och ett ensamt lagnamn tolkas som laget.se (cal.laget.se/<namn>.ics).
// Lagets hemsida på laget.se eller Svenska lag görs om till lagets kalenderflöde.
// null = går inte att tolka som länk.
function calUrl(v){
  v=String(v||'').trim();
  if(!v)return '';
  v=v.replace(/^webcal:\/\//i,'https://');
  if(/^[\w-]+$/.test(v))return 'https://cal.laget.se/'+v+'.ics';
  if(/^[\w-]+(\.[\w-]+)+(\/[^\s]*)?$/.test(v))v='https://'+v;
  if(!/^https?:\/\/[^\s]+$/i.test(v))return null;
  var m=/^https?:\/\/(?:www\.)?laget\.se\/([\w-]+)/i.exec(v);
  if(m)return 'https://cal.laget.se/'+m[1]+'.ics';
  m=/^https?:\/\/(?:www\.)?svenskalag\.se\/([\w-]+)/i.exec(v);
  if(m)return 'https://cal.svenskalag.se/'+m[1];
  return v;
}
function hostOf(u){var m=/^https?:\/\/([^\/?#]+)/i.exec(u||'');return m?m[1].replace(/^www\./,''):u;}

// Kalendern hämtas direkt i webbläsaren. Det kräver att plattformen tillåter det (CORS) — laget.se gör det,
// Svenska lag och SportAdmin inte än (kräver proxy). Då hänvisas tränaren till filimport.
var feedBusy=false,feedErr=null;
function fetchCal(u,quiet,cb){
  feedBusy=true;renderActs();
  fetch(u,{cache:'no-store'}).then(function(r){
    if(!r.ok)throw new Error('http '+r.status);
    return r.text();
  }).then(function(txt){
    if(!/BEGIN:VCALENDAR/i.test(txt))throw new Error('notcal');
    feedBusy=false;feedErr=null;S.feedAt=new Date().toISOString();
    importText(txt,'kalendern',quiet);
    save();renderActs();cb&&cb(null);
  }).catch(function(e){
    // En ny länk som testas i dialogen ska inte märka den sparade kalendern som trasig.
    var err=calErr(u,e);
    feedBusy=false;if(S.team&&u===S.team.cal)feedErr=err;
    renderActs();cb&&cb(err);
  });
}
function calErr(u,e){
  var h=hostOf(u),m=String(e&&e.message||e);
  if(m==='notcal')return h+' svarade, men det var ingen kalender. Kontrollera länken — på laget.se och Svenska lag räcker lagets hemsida.';
  if(/^http 404/.test(m))return 'Hittade ingen kalender på '+h+'. Stämmer lagets namn i länken?';
  if(/^http /.test(m))return h+' svarade med fel ('+m.slice(5)+'). Försök igen om en stund.';
  if(/svenskalag\.se|sportnik\.com|sportadmin/i.test(h))return h+' tillåter inte att kalendern hämtas direkt härifrån än. Ladda ner kalenderfilen (.ics) där och välj "Importera fil i stället".';
  return 'Kunde inte hämta kalendern från '+h+'. Antingen saknas internet, eller så tillåter sidan inte direkt hämtning — prova att importera filen i stället.';
}
function sync(quiet){
  var u=S.team&&S.team.cal;
  if(!u||feedBusy)return;
  fetchCal(u,quiet,function(err){if(err&&!quiet)say(err);});
}

function cHint(){
  var el=$('cInfo'),u=calUrl($('cLink').value);
  if(u===''){el.textContent='Klistra in lagets hemsida på laget.se eller Svenska lag, eller en kalenderlänk (.ics, webcal://).';delete el.dataset.ok;}
  else if(u===null){el.textContent='Det där ser inte ut som en länk.';el.dataset.ok='0';}
  else{el.textContent='Hämtar från '+u;el.dataset.ok='1';}
}
function openCal(){
  $('cLink').value=(S.team&&S.team.cal)||'';
  $('cFetch').disabled=false;$('cFetch').textContent='Hämta';
  cHint();
  $('calDlg').showModal();
  $('cLink').focus();
}
function fetchFromDlg(){
  var u=calUrl($('cLink').value);
  if(!u){$('cLink').focus();cHint();if(u==='')say('Klistra in en länk först.');return;}
  if(feedBusy)return;
  $('cFetch').disabled=true;$('cFetch').textContent='Hämtar…';
  fetchCal(u,false,function(err){
    $('cFetch').disabled=false;$('cFetch').textContent='Hämta';
    if(err){var el=$('cInfo');el.textContent=err;el.dataset.ok='0';return;}
    S.team=S.team||{};S.team.cal=u;save();
    $('calDlg').close();render();
  });
}
$('cLink').addEventListener('input',cHint);
$('cLink').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();fetchFromDlg();}});
$('cFetch').addEventListener('click',fetchFromDlg);
$('cFile').addEventListener('click',function(){$('calDlg').close();$('icsFile').click();});
function applyTeam(){
  var t=S.team||{},img=$('teamLogo');
  $('teamName').textContent=t.name||'Kedjebygget';
  document.title=t.name?t.name+' · Kedjebygget':'Kedjebygget';
  if(t.logo){img.src=t.logo;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}
  setLogo(t.logo);
}

// Loggan skalas ner till högst 400 px och sparas som PNG (behåller genomskinlighet). Blir den ändå stor
// används WebP, så att localStorage inte fylls av en enda bild.
function readLogo(f,cb){
  var r=new FileReader();
  r.onload=function(){
    var im=new Image();
    im.onload=function(){
      var w=im.naturalWidth||400,h=im.naturalHeight||400,k=Math.min(1,400/Math.max(w,h));
      var cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*k));cv.height=Math.max(1,Math.round(h*k));
      cv.getContext('2d').drawImage(im,0,0,cv.width,cv.height);
      var d=cv.toDataURL('image/png');
      if(d.length>300000){var wp=cv.toDataURL('image/webp',.9);if(wp.indexOf('data:image/webp')===0&&wp.length<d.length)d=wp;}
      cb(d);
    };
    im.onerror=function(){cb(null);};
    im.src=String(r.result);
  };
  r.onerror=function(){cb(null);};
  r.readAsDataURL(f);
}

var tLogo=null,teamFirst=false;
function renderLogoPrev(){
  var el=$('tLogoPrev');
  el.dataset.has=tLogo?'1':'0';
  el.innerHTML=tLogo?'<img alt="Vald logga" src="'+esc(tLogo)+'">':'<span>Ingen logga</span>';
  $('tLogoDel').hidden=!tLogo;
  $('tLogoPick').textContent=tLogo?'Byt bild…':'Välj bild…';
}
function calHint(){
  var el=$('tCalInfo'),u=calUrl($('tCal').value);
  if(u===''){el.textContent='Klistra in lagets hemsida på laget.se eller Svenska lag, eller en kalenderlänk (.ics, webcal://). Kan också läggas in senare under Aktiviteter.';delete el.dataset.ok;}
  else if(u===null){el.textContent='Det där ser inte ut som en länk. Klistra in hela adressen.';el.dataset.ok='0';}
  else{el.textContent='Kalendern hämtas från '+u;el.dataset.ok='1';}
}
function openTeam(first){
  var t=S.team||{};
  teamFirst=!!first;
  $('tName').value=t.name||'';$('tCal').value=t.cal||'';
  tLogo=t.logo||null;
  renderLogoPrev();calHint();
  $('teamTitle').textContent=first?'Välkommen till Kedjebygget':'Ditt lag';
  $('teamIntro').hidden=!first;$('tCancel').hidden=!!first;
  $('tSave').textContent=first?'Kom igång':'Spara';
  $('teamDlg').showModal();
  $('tName').focus();
}
function saveTeam(){
  var name=$('tName').value.trim(),cal=calUrl($('tCal').value);
  if(!name){$('tName').focus();say('Skriv lagets namn.');return;}
  if(cal===null){$('tCal').focus();say('Kalenderlänken går inte att läsa — rätta den eller töm fältet.');return;}
  var first=teamFirst,old=S.team&&S.team.cal;
  S.team={name:name,logo:tLogo,cal:cal};
  save();applyTeam();$('teamDlg').close();render();
  say(first?(cal?'Klart! Hämtar kalendern…':'Klart! Lägg till spelare eller hämta kalendern under Aktiviteter.'):'Laget sparat.');
  if(cal&&cal!==old){feedErr=null;sync(false);}
}
$('teamBtn').addEventListener('click',function(){openTeam(false);});
if(FEEDBACK_URL)$('feedbackLink').href=FEEDBACK_URL;
$('feedbackLink').addEventListener('click',function(e){
  if(!FEEDBACK_URL){e.preventDefault();say('Formuläret är inte kopplat än.');}
});
$('tSave').addEventListener('click',saveTeam);
$('tCal').addEventListener('input',calHint);
// Första gången går dialogen inte att stänga med Esc — laget måste ha ett namn.
$('teamDlg').addEventListener('cancel',function(e){if(teamFirst)e.preventDefault();});
// Enter sparar (annars skulle formulärets första knapp, Avbryt, ta emot det).
[$('tName'),$('tCal')].forEach(function(el){
  el.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();saveTeam();}});
});
$('tLogoPick').addEventListener('click',function(){$('tLogoFile').click();});
$('tLogoDel').addEventListener('click',function(){tLogo=null;renderLogoPrev();});
$('tLogoFile').addEventListener('change',function(){
  var f=this.files&&this.files[0];if(!f)return;this.value='';
  readLogo(f,function(d){
    if(!d){say('Kunde inte läsa '+f.name+' som bild.');return;}
    tLogo=d;renderLogoPrev();
  });
});

/* ---------- start ---------- */
if(!load())seed();
if(!S.sets.length){var s0=newSet('Ny uppställning');S.sets=[s0];S.active=s0.id;}
if(!active())S.active=S.sets[0].id;
applyTeam();
render();
if(!S.team||!S.team.name)openTeam(true);
else sync(true);
})();
