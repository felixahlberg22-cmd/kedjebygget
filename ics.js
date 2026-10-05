/* Kalenderparser för .ics-flöden (t.ex. laget.se). Delas mellan app.js (webbläsare, global ICS)
   och sync/laget.mjs (Node, via require). Ger aktiviteter enligt datamodellen i CLAUDE.md. */
(function(root){
"use strict";

function pad(n){return (n<10?'0':'')+n;}
function localIso(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());}

// Radbrytningar i .ics fortsätter på nästa rad om den börjar med blanksteg eller tabb.
function unfold(txt){return String(txt).replace(/\r\n?/g,'\n').replace(/\n[ \t]/g,'');}
function unesc(v){return v.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1').trim();}

// UTC-tider (Z) räknas om till lokal tid. Tider med TZID eller utan zon antas redan vara lokala.
function parseDate(v){
  var m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(String(v).trim());
  if(!m)return '';
  if(!m[4])return m[1]+'-'+m[2]+'-'+m[3];
  if(m[7])return localIso(new Date(Date.UTC(+m[1],m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0))));
  return m[1]+'-'+m[2]+'-'+m[3]+'T'+m[4]+':'+m[5];
}

// laget.se sätter CATEGORIES till Träning / Match / Övrig aktivitet — den går före gissning på titeln.
function classify(text,cat){
  var c=String(cat||'').toLowerCase();
  if(/match/.test(c))return 'match';
  if(/tr[äa]ning/.test(c))return 'traning';
  if(/[öo]vrig/.test(c))return 'ovrigt';
  var t=String(text||'').toLowerCase();
  if(/match/.test(t))return 'match';
  if(/tr[äa]ning|ispass|fyspass|isträning/.test(t))return 'traning';
  if(/\bcup\b|serie|\bvs\.?\s|\s[-–]\s|\bmot\b/.test(t))return 'match';
  return 'ovrigt';
}

// Delar "NAMN;PARAM=x:värde" vid första kolon utanför citattecken.
function splitProp(line){
  var q=false;
  for(var i=0;i<line.length;i++){
    var c=line[i];
    if(c==='"')q=!q;
    else if(c===':'&&!q)return [line.slice(0,i).split(';')[0].toUpperCase(),line.slice(i+1)];
  }
  return null;
}

// "https://maps.app.goo.gl/… (Gärdet idrottsplats, Östermalm)" → "Gärdet idrottsplats, Östermalm"
function cleanLoc(v){
  var m=/^https?:\/\/\S+\s*\((.*)\)\s*$/.exec(v);
  return (m?m[1]:v.replace(/https?:\/\/\S+/g,'')).trim();
}
// laget.se lägger samlingstiden i beskrivningen: "Samlingstid\n2026-10-10 11:00".
function gatherOf(desc){
  var m=/Samlingstid\s*\n\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})/i.exec(desc);
  return m?m[1]+'T'+(m[2].length<2?'0':'')+m[2]+':'+m[3]:'';
}

function hash(s){var h=0;for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return 'ev'+(h>>>0).toString(36);}

function parse(txt){
  var lines=unfold(txt).split('\n'),out=[],ev=null;
  for(var i=0;i<lines.length;i++){
    var l=lines[i];
    if(/^BEGIN:VEVENT/i.test(l)){ev={};continue;}
    if(/^END:VEVENT/i.test(l)){
      if(ev&&ev.DTSTART){
        var title=unesc(ev.SUMMARY||'')||'Aktivitet';
        var start=parseDate(ev.DTSTART);
        if(start)out.push({
          id:ev.UID?unesc(ev.UID):hash(start+title),
          type:classify(title,unesc(ev.CATEGORIES||'')),
          start:start,
          end:ev.DTEND?parseDate(ev.DTEND):'',
          gather:gatherOf(unesc(ev.DESCRIPTION||'')),
          title:title,
          location:cleanLoc(unesc(ev.LOCATION||'')),
          cancelled:/CANCEL/i.test(ev.STATUS||'')||/^inst[äa]lld/i.test(title),
          attending:[]
        });
      }
      ev=null;continue;
    }
    if(!ev)continue;
    var p=splitProp(l);
    if(p&&!(p[0] in ev))ev[p[0]]=p[1];
  }
  out.sort(function(a,b){return a.start<b.start?-1:a.start>b.start?1:0;});
  return out;
}

var api={parse:parse,classify:classify,parseDate:parseDate};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.ICS=api;
})(this);
