'use strict';
const $=id=>document.getElementById(id);
const state={files:[],outputs:[],report:null,urls:[]};
const kinds={image:['png','jpg','jpeg','webp'],audio:['mp3','wav','ogg','m4a','flac'],video:['mp4','webm'],text:['txt','md','csv','json']};
const ext=f=>f.name.split('.').pop().toLowerCase();
const kind=f=>Object.keys(kinds).find(k=>kinds[k].includes(ext(f)))||'unknown';
const bytes=n=>n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function renderFiles(){
  $('files').innerHTML='';
  state.files.forEach((f,i)=>{
    const d=document.createElement('div'); d.className='file';
    d.innerHTML='<div><b>'+esc(f.name)+'</b><small>'+kind(f).toUpperCase()+' · '+bytes(f.size)+'</small></div><button data-i="'+i+'">×</button>';
    d.querySelector('button').onclick=()=>{state.files.splice(i,1);renderFiles()};
    $('files').appendChild(d);
  });
  $('run').disabled=!state.files.length;
}
function addFiles(list){state.files=[...state.files,...list].filter(f=>kind(f)!=='unknown').slice(0,20);renderFiles()}
$('drop').onclick=()=>$('picker').click();
$('drop').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('picker').click()}};
$('picker').onchange=e=>addFiles(e.target.files);
$('drop').ondragover=e=>{e.preventDefault();$('drop').classList.add('drag')};
$('drop').ondragleave=()=>$('drop').classList.remove('drag');
$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('drag');addFiles(e.dataTransfer.files)};
$('quality').oninput=()=>$('ql').textContent=$('quality').value+'%';
$('peak').oninput=()=>$('pl').textContent=$('peak').value+' dBFS';

document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));
 document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('hidden',x.id!==b.dataset.tab));
});

async function sha(blob){
 if(!crypto.subtle)return null;
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));
 return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');
}
const canvasBlob=(c,t,q)=>new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(Error('Canvas export failed')),t,q));

async function imageProcess(f,o){
 const bmp=await createImageBitmap(f);
 try{
  const c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(bmp.width*o.scale)); c.height=Math.max(1,Math.round(bmp.height*o.scale));
  const ctx=c.getContext('2d');
  ctx.filter=o.profile==='creative'?'contrast(1.05) saturate(1.07)':o.profile==='stress'?'contrast(1.1) saturate(1.14) blur(.45px)':'none';
  ctx.drawImage(bmp,0,0,c.width,c.height);
  const mime=o.imgfmt==='auto'?(f.type==='image/png'||f.type==='image/webp'?f.type:'image/jpeg'):o.imgfmt;
  const blob=await canvasBlob(c,mime,o.quality/100);
  return {blob,ext:mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg',details:{width:c.width,height:c.height,mime}};
 }finally{bmp.close()}
}

function wavEncode(buf){
 const ch=buf.numberOfChannels,n=buf.length,sr=buf.sampleRate,out=new ArrayBuffer(44+n*ch*2),v=new DataView(out);
 const w=(p,s)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i))};
 w(0,'RIFF');v.setUint32(4,36+n*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);v.setUint32(24,sr,true);v.setUint32(28,sr*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,n*ch*2,true);
 let p=44; for(let i=0;i<n;i++)for(let c=0;c<ch;c++){let s=Math.max(-1,Math.min(1,buf.getChannelData(c)[i]));v.setInt16(p,s<0?s*32768:s*32767,true);p+=2}
 return new Blob([out],{type:'audio/wav'});
}
async function audioProcess(f,o){
 const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio unsupported');
 const ac=new AC();
 try{
  const decoded=await ac.decodeAudioData(await f.arrayBuffer()); if(decoded.duration>600)throw Error('Audio > 10 min browser limit');
  const channels=Math.min(2,decoded.numberOfChannels),frames=Math.ceil(decoded.duration*o.sr),oc=new OfflineAudioContext(channels,frames,o.sr);
  const src=oc.createBufferSource();src.buffer=decoded;let tail=src;
  const addFilter=(type,freq,gain=0)=>{const x=oc.createBiquadFilter();x.type=type;x.frequency.value=freq;x.gain.value=gain;tail.connect(x);tail=x};
  if(o.apreset==='master'){addFilter('highpass',35);addFilter('lowshelf',140,1.2);addFilter('peaking',2600,.8)}
  if(o.apreset==='lowpass')addFilter('lowpass',12000);
  if(o.apreset==='highpass')addFilter('highpass',120);
  const gain=oc.createGain();tail.connect(gain);gain.connect(oc.destination);
  if(o.fade){gain.gain.setValueAtTime(0,0);gain.gain.linearRampToValueAtTime(1,.3);gain.gain.setValueAtTime(1,Math.max(.3,decoded.duration-.3));gain.gain.linearRampToValueAtTime(0,decoded.duration)}
  src.start(); let rendered=await oc.startRendering();
  if(o.norm){
    let m=0;for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)m=Math.max(m,Math.abs(d[i]))}
    if(m>0){const target=Math.pow(10,o.peak/20),ratio=target/m;for(let c=0;c<rendered.numberOfChannels;c++){const d=rendered.getChannelData(c);for(let i=0;i<d.length;i++)d[i]*=ratio}}
  }
  return {blob:wavEncode(rendered),ext:'wav',details:{duration:+decoded.duration.toFixed(2),sample_rate:o.sr,preset:o.apreset,normalized:o.norm,peak_dbfs:o.peak}};
 }finally{ac.close()}
}
async function textProcess(f,o){
 let t=(await f.text()).normalize(o.unicode),before=t.length;
 if(o.invisible)t=t.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g,'');
 return {blob:new Blob([t],{type:f.type||'text/plain'}),ext:ext(f),details:{chars_before:before,chars_after:t.length,unicode:o.unicode}};
}
async function videoProcess(f){
 return {blob:f.slice(0,f.size,f.type),ext:ext(f),details:{mode:'baseline-copy',note:'Browser build does not claim video watermark removal; file retained for detector baseline.'}};
}
function opts(){return {profile:$('profile').value,quality:+$('quality').value,scale:+$('scale').value,imgfmt:$('imgfmt').value,apreset:$('apreset').value,sr:+$('sr').value,peak:+$('peak').value,norm:$('norm').checked,fade:$('fade').checked,unicode:$('unicode').value,invisible:$('invisible').checked,originals:$('originals').checked}}
function outName(f,e,i){const base=f.name.replace(/\.[^.]+$/,'');return base+'__lab_'+String(i+1).padStart(2,'0')+'.'+e}
function download(blob,name){const u=URL.createObjectURL(blob);state.urls.push(u);const a=document.createElement('a');a.href=u;a.download=name;a.click()}
function csvBlob(){
 if(!state.report)return new Blob([''],{type:'text/csv'});
 const rows=[['file','kind','input_sha256','output','output_sha256','status']];
 state.report.files.forEach(x=>rows.push([x.input_name,x.kind,x.input_sha256||'',x.output_name||'',x.output_sha256||'',x.status]));
 return new Blob([rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')],{type:'text/csv'});
}
$('run').onclick=async()=>{
 const o=opts(); state.outputs=[]; $('results').innerHTML=''; $('bar').style.width='0'; $('run').disabled=true;
 state.report={app:'AI Watermark Lab',version:'1.2',started_at:new Date().toISOString(),settings:o,files:[]};
 for(let i=0;i<state.files.length;i++){
  const f=state.files[i],k=kind(f),rec={input_name:f.name,kind:k,input_bytes:f.size,input_sha256:await sha(f),status:'processing'};
  $('status').textContent='Processing '+f.name;
  try{
   let r=k==='image'?await imageProcess(f,o):k==='audio'?await audioProcess(f,o):k==='text'?await textProcess(f,o):await videoProcess(f,o);
   const name=outName(f,r.ext,i);rec.output_name=name;rec.output_bytes=r.blob.size;rec.output_sha256=await sha(r.blob);rec.details=r.details;rec.status='ok';
   state.outputs.push({name,blob:r.blob,original:f});
   const d=document.createElement('div');d.className='file';d.innerHTML='<div><b>'+esc(name)+'</b><small>'+bytes(r.blob.size)+'</small></div><a href="#">Download</a>';d.querySelector('a').onclick=e=>{e.preventDefault();download(r.blob,name)};$('results').appendChild(d);
  }catch(e){rec.status='error';rec.error=e.message;const d=document.createElement('div');d.className='file';d.textContent=f.name+' · ERROR · '+e.message;$('results').appendChild(d)}
  state.report.files.push(rec);$('bar').style.width=Math.round((i+1)/state.files.length*100)+'%';
 }
 state.report.finished_at=new Date().toISOString();$('status').textContent='Experiment complete · '+state.outputs.length+' outputs';
 $('reportText').textContent=JSON.stringify(state.report,null,2);$('zip').disabled=!state.outputs.length;$('json').disabled=false;$('csv').disabled=false;$('run').disabled=false;
};
$('json').onclick=()=>download(new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),'experiment_report.json');
$('csv').onclick=()=>download(csvBlob(),'experiment_report.csv');
$('zip').onclick=async()=>{
 if(!window.JSZip){alert('ZIP library unavailable. Use individual downloads.');return}
 const z=new JSZip();state.outputs.forEach(x=>{z.file(x.name,x.blob);if(opts().originals)z.file('originals/'+x.original.name,x.original)});
 z.file('experiment_report.json',JSON.stringify(state.report,null,2));z.file('experiment_report.csv',csvBlob());
 download(await z.generateAsync({type:'blob'}),'ai_watermark_lab_results.zip');
};