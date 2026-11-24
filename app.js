/* 保固維修回報 App — 網頁放在 GitHub Pages，案件存成私人 repo 的 Issues，照片存成同一 repo 的檔案。 */
"use strict";
const CFG = window.WARRANTY_CONFIG;
const API = 'https://api.github.com';
const REPO = `/repos/${CFG.owner}/${CFG.repo}`;
const TOKEN_KEY = 'wr_token';

/* ---------- constants ---------- */
const STATUSES = ['草稿', '已送出', '總公司已收件', '需補件', '已核准', '已結案'];
const STATUS_COLORS = {'草稿':'cfd3dc','已送出':'2342a0','總公司已收件':'5b7bd5','需補件':'e0a030','已核准':'1d7a4c','已結案':'6e7681'};
const CATS = ['機體銘牌／機號','出風溫濕度量測','運轉電流量測','控制面板顯示','管溫量測','濾網','配線','安裝現況','故障部位','故障零件','其他'];
const HANDLING = ['修理', '新品', '重修', '更換新設備', '其他'];
const REQUESTS = ['申請更換新機', '申請零件', '申請技術支援', '回報備查'];
const WARRANTY = ['保內', '保外', '待確認'];
const OTHER = '其他零配件／其他';
const PRODUCTS = ['吊隱式除濕機', '新風除濕機', '全熱交換器', '空氣清淨機', '渦流風扇', '動力分配箱', OTHER];
/* 依產品決定要填的量測與建議照片；都不是必填 */
const PROFILES = {
  dehum:   {meas:['ambT','ambRH','outT','outRH','current','pipeT','voltage','runtime'], photos:['機體銘牌／機號','出風溫濕度量測','運轉電流量測','控制面板顯示','管溫量測','安裝現況','故障部位'], diag:true, comp:true},
  erv:     {meas:['current','voltage','runtime'], photos:['機體銘牌／機號','控制面板顯示','濾網','安裝現況','故障部位']},
  purifier:{meas:['current','voltage'], photos:['機體銘牌／機號','控制面板顯示','濾網','故障部位']},
  fan:     {meas:['current','voltage'], photos:['機體銘牌／機號','安裝現況','故障部位']},
  panel:   {meas:['voltage','current'], photos:['機體銘牌／機號','配線','安裝現況','故障部位']},
  part:    {meas:[], photos:['故障零件','安裝現況']}};
function profileOf(r){return PROFILES[{'吊隱式除濕機':'dehum','新風除濕機':'dehum','全熱交換器':'erv','空氣清淨機':'purifier','渦流風扇':'fan','動力分配箱':'panel'}[r.product]||'part']}
function productLabel(r){return r.product===OTHER?(r.productOther||'其他零配件'):r.product}
function diag(r){return profileOf(r).diag?diagnose(r.meas):[]}
function measList(r){return MEAS.filter(m=>profileOf(r).meas.includes(m.k))}
const MEAS = [
  {k:'ambT',l:'環境溫度',u:'°C'}, {k:'ambRH',l:'環境濕度',u:'%RH'},
  {k:'outT',l:'出風溫度',u:'°C'}, {k:'outRH',l:'出風濕度',u:'%RH'},
  {k:'current',l:'運轉電流',u:'A'}, {k:'pipeT',l:'管溫',u:'°C'},
  {k:'voltage',l:'電源電壓',u:'V'}, {k:'runtime',l:'運轉時間',u:'分'}];

/* ---------- state ---------- */
const S = {token: '', me: null, canWrite: false, loaded: false, reports: [], urls: {}, urlP: {},
  view: null, draft: null, editingNo: null, filter: '全部', q: '', note: ''};

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
function today(){const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function roc(s){if(!s)return '';const m=String(s).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);if(!m)return esc(s);const y=+m[1]-1911;return m[3]?`${y}/${m[2]}/${m[3]}`:`${y}/${m[2]}`}
function rocDT(iso){if(!iso)return '';const d=new Date(iso);if(isNaN(d))return '';return `${d.getFullYear()-1911}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`}
function uid(p='r'){return p+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function num(v){if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null}
function toast(msg,kind){const t=document.createElement('div');t.className='t'+(kind?' '+kind:'');t.textContent=msg;$('#toast').append(t);setTimeout(()=>t.remove(),kind==='bad'?6000:3200)}
function saveFile(blob,filename){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000)}

function blankReport(){return{key:uid(),no:'',branch:CFG.branchName||'米多力中部分公司',customer:'',contact:'',phone:'',address:'',
  regDate:today(),serviceDate:today(),product:'吊隱式除濕機',productOther:'',model:'',serial:'',installDate:'',purchaseDate:'',warrantyCard:'',
  warranty:'保內',fault:'',handling:'修理',agreement:'',
  meas:{ambT:'',ambRH:'',outT:'',outRH:'',current:'',pipeT:'',voltage:'',runtime:'',compOn:true},
  inspection:'',request:'申請更換新機',parts:'',urgency:'一般',tech:'',
  formPhoto:null,photos:[],status:'草稿',log:[],hqNote:'',createdBy:'',createdAt:'',updatedAt:''}}
function normalize(r){const b=blankReport();const o=Object.assign(b,r||{});o.meas=Object.assign(b.meas,(r&&r.meas)||{});
  o.photos=Array.isArray(o.photos)?o.photos.filter(p=>p&&typeof p.path==='string'):[];o.log=Array.isArray(o.log)?o.log:[];
  if(o.formPhoto&&typeof o.formPhoto.path!=='string')o.formPhoto=null;
  if(!PRODUCTS.includes(o.product)){const map={'除濕機':'吊隱式除濕機','全熱交換機':'全熱交換器'};if(map[o.product])o.product=map[o.product];else{o.productOther=o.productOther||o.product||'';o.product=OTHER}}if(!STATUSES.includes(o.status))o.status='已送出';return o}

/* 判讀提示：一般除濕機檢修經驗，僅供參考 */
function diagnose(m){const out=[];const aRH=num(m.ambRH),oRH=num(m.outRH),aT=num(m.ambT),pT=num(m.pipeT);
  if(aRH!=null&&oRH!=null){const d=aRH-oRH;
    if(d<3)out.push({lv:'bad',t:`出風濕度 ${oRH}% 與環境 ${aRH}% 幾乎相同（降幅 ${d.toFixed(1)}%），機器沒有除濕效果。`});
    else out.push({lv:'ok',t:`出風濕度比環境低 ${d.toFixed(1)}%，有除濕效果。`});}
  if(m.compOn&&aT!=null&&pT!=null){const d=aT-pT;
    if(d<3)out.push({lv:'bad',t:`壓縮機運轉中，管溫 ${pT}°C 接近環境 ${aT}°C，蒸發器沒有降溫，常見於冷媒不足或洩漏。`});
    else out.push({lv:'ok',t:`管溫比環境低 ${d.toFixed(1)}°C，蒸發器有降溫。`});}
  return out}
function suggested(r){const have=new Set((r.photos||[]).map(p=>p.cat));return [{k:'服務單',done:!!r.formPhoto},...profileOf(r).photos.map(k=>({k,done:have.has(k)}))]}

/* ---------- GitHub API ---------- */
async function gh(path,opt={}){
  const headers={'Accept':opt.accept||'application/vnd.github+json','Authorization':'Bearer '+S.token,'X-GitHub-Api-Version':'2022-11-28'};
  if(opt.body)headers['Content-Type']='application/json';
  let r;
  try{r=await fetch(API+path,{method:opt.method||'GET',headers,body:opt.body?JSON.stringify(opt.body):undefined,cache:'no-store'})}
  catch(e){const err=new Error('連不上 GitHub，請確認網路後再試。');err.status=0;throw err}
  if(!r.ok){let msg='';try{msg=(await r.json()).message||''}catch(e){}
    const err=new Error(ghMsg(r.status,msg));err.status=r.status;err.raw=msg;throw err}
  if(opt.raw)return r.blob();if(r.status===204)return null;return r.json()}
function ghMsg(status,msg){
  if(status===401)return '權杖無效或已過期，請重新登入。';
  if(status===403&&/rate limit/i.test(msg))return 'GitHub 使用次數暫時用完，請過幾分鐘再試。';
  if(status===403||status===404)return '你沒有這個資料庫的寫入權限，請請管理者把你的 GitHub 帳號加為協作者，並到 GitHub 接受邀請。';
  if(status===409)return '資料剛好被別人更新，請再按一次。';
  if(status===422)return '資料格式有誤：'+msg;
  return msg||('GitHub 錯誤 '+status)}
const encPath=p=>p.split('/').map(encodeURIComponent).join('/');
const ghBlobURL=p=>`https://github.com/${CFG.owner}/${CFG.repo}/blob/${CFG.branch}/${encPath(p)}?raw=true`;

/* uploads go through one queue: each file is a commit, parallel commits on one branch collide */
let upQueue=Promise.resolve();
function queued(fn){const p=upQueue.then(fn,fn);upQueue=p.catch(()=>{});return p}
async function putFile(path,b64,message){
  const body={message,content:b64,branch:CFG.branch};
  try{return await gh(`${REPO}/contents/${encPath(path)}`,{method:'PUT',body})}
  catch(e){if(e.status===409||e.status===422&&/sha/.test(e.raw||'')){await new Promise(r=>setTimeout(r,1200));return gh(`${REPO}/contents/${encPath(path)}`,{method:'PUT',body})}throw e}}

/* ---------- photos ---------- */
function loadImage(blob){return new Promise((res,rej)=>{const u=URL.createObjectURL(blob);const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('無法讀取這張圖片，請改用 JPG 或 PNG'));i.src=u})}
async function compress(blob,maxSide=1600,q=0.82){const im=await loadImage(blob);const s=Math.min(1,maxSide/Math.max(im.naturalWidth,im.naturalHeight));
  const c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*s);c.height=Math.round(im.naturalHeight*s);
  const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);
  return await new Promise(r=>c.toBlob(r,'image/jpeg',q))}
const toDataURL=b=>new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(b)});
async function storePhoto(file,key,label,maxSide){
  const blob=await compress(file,maxSide);const b64=(await toDataURL(blob)).split(',')[1];
  const path=`photos/${key}/${uid('p')}.jpg`;
  await queued(()=>putFile(path,b64,`照片：${label}`));
  S.urls[path]=URL.createObjectURL(blob);return{path}}
function photoURL(path){if(S.urls[path])return Promise.resolve(S.urls[path]);
  if(!S.urlP[path])S.urlP[path]=gh(`${REPO}/contents/${encPath(path)}?ref=${encodeURIComponent(CFG.branch)}`,{accept:'application/vnd.github.raw',raw:true})
    .then(b=>(S.urls[path]=URL.createObjectURL(b))).catch(e=>{delete S.urlP[path];throw e});
  return S.urlP[path]}
function srcOf(p){if(!p)return '';if(p.preview)return p.preview;return S.urls[p.path]||''}
function imgTag(p){if(!p)return '';const s=srcOf(p);return s?`<img src="${esc(s)}" alt="">`:`<img data-path="${esc(p.path)}" alt="">`}
function hydrate(root){root.querySelectorAll('img[data-path]').forEach(img=>{photoURL(img.dataset.path).then(u=>{img.src=u;img.removeAttribute('data-path')}).catch(()=>{img.alt='照片讀取失敗'})})}
async function ensurePhotos(r){await Promise.all([r.formPhoto,...r.photos].filter(Boolean).map(p=>photoURL(p.path).catch(()=>null)))}

/* ---------- issue <-> report ---------- */
const DATA_RE=/<!-- WARRANTY-DATA\n([\s\S]*?)\n-->/;
function issueTitle(r){return `[${r.no||'未編號'}] ${r.customer||'未填客戶'}｜${r.model||''} ${r.serial||''}｜${r.fault||''}`.trim()}
function md(v){return String(v??'').replace(/\|/g,'\\|').replace(/\n/g,'<br>')||'—'}
function issueBody(r){const m=r.meas;const dx=diag(r);const ml=measList(r).filter(x=>m[x.k]);
  const json=JSON.stringify(r,(k,v)=>k==='preview'||k==='uploading'?undefined:v).replace(/--/g,'-\\u002d');
  const L=[];
  L.push(`## 保固維修回報｜服務單 ${r.no||'—'}`,'',`**狀態：${r.status}**　${r.warranty}${r.urgency==='急件'?'　🔴 急件':''}`,'');
  L.push('| 項目 | 內容 | 項目 | 內容 |','|---|---|---|---|');
  L.push(`| 客戶／案場 | ${md(r.customer)} | 聯絡人／電話 | ${md([r.contact,r.phone].filter(Boolean).join(' '))} |`);
  L.push(`| 地址 | ${md(r.address)} | 登記／服務日 | ${roc(r.regDate)||'—'}／${roc(r.serviceDate)||'—'} |`);
  L.push(`| 產品／機型 | ${md(productLabel(r)+' '+r.model)} | 機號 | ${md(r.serial)} |`);
  L.push(`| 安裝年月 | ${roc(r.installDate)||'—'} | 購買年月／保卡 | ${md([roc(r.purchaseDate),r.warrantyCard].filter(Boolean).join(' '))} |`);
  L.push(`| 故障情況 | ${md(r.fault)} | 處理方式 | ${md(r.handling)} |`);
  L.push(`| 和客戶約定 | ${md(r.agreement)} | 技術員 | ${md(r.tech)} |`,'');
  if(ml.length)L.push(`### 現場量測${profileOf(r).comp&&m.compOn?'（壓縮機運轉中）':''}`,'',`| ${ml.map(x=>x.l).join(' | ')} |`,`|${ml.map(()=>'---').join('|')}|`,`| ${ml.map(x=>`${m[x.k]} ${x.u}`).join(' | ')} |`,'');
  if(dx.length){L.push('### 判讀（系統提示，僅供參考）','',...dx.map(d=>`- ${d.lv==='bad'?'⚠️':'✅'} ${d.t}`),'')}
  L.push('### 檢修情況','',r.inspection?r.inspection.split('\n').map(x=>'> '+x).join('\n'):'—','');
  L.push('### 申請總公司','',`**${r.request}**${r.urgency==='急件'?'（急件）':''}${r.parts?`　零件／新機：${r.parts}`:''}`,'');
  if(r.hqNote)L.push('### 總公司回覆','',r.hqNote,'');
  if(r.formPhoto)L.push('### 服務單影本','',`<img src="${ghBlobURL(r.formPhoto.path)}" width="560">`,'');
  if(r.photos.length){L.push('### 現場照片','');r.photos.forEach((p,i)=>L.push(`**${pad(i+1)}｜${p.cat}**　${p.caption||''}`,'',`<img src="${ghBlobURL(p.path)}" width="420">`,''))}
  L.push('---',`<sub>此為保固維修回報 App 的資料備份，請到 App 查看與處理：https://medole-warranty.github.io/warranty-app/</sub>`,'',`<!-- WARRANTY-DATA\n${json}\n-->`);
  return L.join('\n')}
function fromIssue(is){const mm=(is.body||'').match(DATA_RE);if(!mm)return null;
  let d;try{d=JSON.parse(mm[1])}catch(e){return null}
  const r=normalize(d);r.number=is.number;r.url=is.html_url;r.issueUser=is.user&&is.user.login;
  const lab=(is.labels||[]).map(l=>typeof l==='string'?l:l.name).find(n=>n&&n.startsWith('狀態:'));
  if(lab&&STATUSES.includes(lab.slice(3)))r.status=lab.slice(3);else if(is.state==='closed')r.status='已結案';
  r.updatedAt=r.updatedAt||is.updated_at;r.createdAt=r.createdAt||is.created_at;r.createdBy=r.createdBy||r.issueUser;
  return r}
function labelsFor(r){return [CFG.label,'狀態:'+r.status,...(r.urgency==='急件'?['急件']:[])]}
async function ensureLabels(){try{const have=new Set((await gh(`${REPO}/labels?per_page=100`)).map(l=>l.name));
  const want=[[CFG.label,'0e6f78'],...STATUSES.map(s=>['狀態:'+s,STATUS_COLORS[s]]),['急件','c2303a']];
  for(const [name,color] of want)if(!have.has(name)){try{await gh(`${REPO}/labels`,{method:'POST',body:{name,color}})}catch(e){}}}catch(e){}}
async function loadReports(){const out=[];
  for(let page=1;page<=10;page++){const list=await gh(`${REPO}/issues?state=all&labels=${encodeURIComponent(CFG.label)}&per_page=100&page=${page}&sort=created&direction=desc`);
    list.forEach(is=>{if(!is.pull_request){const r=fromIssue(is);if(r)out.push(r)}});if(list.length<100)break}
  return out}
async function refresh(silent){try{S.reports=await loadReports();S.loaded=true;S.note=''}
  catch(e){S.loaded=true;S.note='讀取案件失敗：'+e.message;if(e.status===401){logout();return}}
  if(!(S.view==='form'&&S.draft))route()}

/* ---------- 共用設定（存在私人資料庫的 settings.json） ---------- */
function b64dec(str){const bin=atob(String(str).replace(/\s/g,''));return new TextDecoder().decode(Uint8Array.from(bin,c=>c.charCodeAt(0)))}
function b64enc(str){const bytes=new TextEncoder().encode(str);let bin='';for(let i=0;i<bytes.length;i++)bin+=String.fromCharCode(bytes[i]);return btoa(bin)}
async function loadSettings(){try{const f=await gh(`${REPO}/contents/settings.json?ref=${encodeURIComponent(CFG.branch)}`);S.settingsSha=f.sha;S.settings=JSON.parse(b64dec(f.content))||{}}
  catch(e){S.settings={};S.settingsSha=null}}
async function saveSettings(){const body={message:'更新 App 設定',content:b64enc(JSON.stringify(S.settings,null,2)),branch:CFG.branch};if(S.settingsSha)body.sha=S.settingsSha;
  const r=await queued(()=>gh(`${REPO}/contents/settings.json`,{method:'PUT',body}));S.settingsSha=r.content&&r.content.sha}
const aiReady=()=>!!(S.settings&&S.settings.geminiKey);

/* ---------- AI 辨識服務單（Google Gemini） ---------- */
const GEM='https://generativelanguage.googleapis.com/v1beta';
const AI_PROMPT=`這是一張「貫捷科技服務單」（米多力 MEDOLE 產品維修服務單）的照片，內容多為手寫。請仔細辨識手寫字，只回傳一個 JSON 物件，不要其他文字。讀不到或空白的欄位填空字串 ""。
{"no":"右上角紅色印刷的單號，只要數字",
"customer":"姓名欄",
"phone":"手機或市話",
"address":"表頭地址各格（市縣、區鄉鎮、里村、路街、段、巷、弄、號樓）合併成一行",
"regDate":"登記日期；民國年加 1911 換成西元，格式 YYYY-MM-DD",
"serviceDate":"服務時間，格式同上",
"productText":"產品欄的原文",
"productCategory":"從這些擇一：吊隱式除濕機、新風除濕機、全熱交換器、空氣清淨機、渦流風扇、動力分配箱、其他。產品欄只寫除濕機、機型像 MD-70LB 這種 MD 開頭 LB 結尾的，選吊隱式除濕機；寫的是零件（馬達、主機板、排水泵、濾網、面板、風扇葉片等）或看不出類別，選其他",
"model":"機型","serial":"機號","warrantyCard":"保卡號碼",
"purchaseDate":"購買日期，西元 YYYY-MM",
"fault":"故障情況",
"handling":"處理欄打勾的項目：修理、新品 或 重修；都沒勾填空",
"agreement":"和客戶約定事項",
"inspection":"檢修情況全文，保留換行",
"ambT":"環境溫度數字","ambRH":"環境濕度數字","outT":"出風溫度數字","outRH":"出風濕度數字",
"current":"運轉電流數字（A）","pipeT":"管溫數字（°C）","voltage":"電壓數字（V）",
"compOn":"檢修情況寫在壓縮機啟動下測量填 true，否則 false"}
若寫出風濕度「與環境相同」，環境濕度填同一個數字；若寫管溫「與現場相同」，環境溫度填同一個數字。`;
async function gemPost(model,body,key){return fetch(`${GEM}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}
async function pickModel(key){try{const r=await fetch(`${GEM}/models?pageSize=200&key=${encodeURIComponent(key)}`);if(!r.ok)return '';
  const list=((await r.json()).models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))
    .filter(n=>/flash/.test(n)&&!/image|tts|live|audio|embed|exp/.test(n));
  const score=n=>(/lite/.test(n)?0:2)+(/preview/.test(n)?0:1);
  list.sort((a,b)=>score(b)-score(a)||b.localeCompare(a,undefined,{numeric:true}));return list[0]||''}catch(e){return ''}}
async function geminiRead(blob){const key=S.settings.geminiKey;
  const small=await compress(blob,1800,0.85);const data=(await toDataURL(small)).split(',')[1];
  const body={contents:[{role:'user',parts:[{text:AI_PROMPT},{inline_data:{mime_type:'image/jpeg',data}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}};
  let model=S.settings.geminiModel||'gemini-flash-latest';let r;
  try{r=await gemPost(model,body,key)}catch(e){throw new Error('連不上 Google AI，請確認網路。')}
  if(r.status===404){const m2=await pickModel(key);if(m2&&m2!==model){model=m2;r=await gemPost(model,body,key);if(r.ok){S.settings.geminiModel=model;saveSettings().catch(()=>{})}}}
  if(!r.ok){let msg='';try{msg=((await r.json()).error||{}).message||''}catch(e){}
    if(r.status===400&&/API key/i.test(msg))throw new Error('AI 金鑰不正確，請到右上角「設定」重新貼上。');
    if(r.status===403)throw new Error('AI 金鑰沒有權限，請確認金鑰是否已停用。');
    if(r.status===429)throw new Error('AI 免費額度暫時用完，請過一分鐘再試，或改天再按「重新辨識」。');
    throw new Error('AI 辨識失敗：'+(msg||r.status))}
  const j=await r.json();const text=((((j.candidates||[])[0]||{}).content||{}).parts||[]).map(p=>p.text||'').join('');
  const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error('AI 沒有讀出內容，可以換一張清楚的照片再試。');
  return JSON.parse(m[0])}
/* 把辨識結果填進草稿；auto=true 時不覆蓋使用者已經改過的欄位 */
function applyAI(r,j,auto){const filled=[];const can=k=>!auto||!(r._touched&&r._touched[k]);
  const put=(k,v)=>{if(v==null)return;v=String(v).trim();if(!v||!can(k))return;r[k]=v;filled.push(k)};
  ['no','customer','phone','address','model','serial','warrantyCard','fault','agreement','inspection'].forEach(k=>put(k,j[k]));
  if(/^\d{4}-\d{2}-\d{2}$/.test(j.regDate||''))put('regDate',j.regDate);
  if(/^\d{4}-\d{2}-\d{2}$/.test(j.serviceDate||''))put('serviceDate',j.serviceDate);
  if(/^\d{4}-\d{2}$/.test(j.purchaseDate||''))put('purchaseDate',j.purchaseDate);
  if(HANDLING.includes(j.handling))put('handling',j.handling);
  const cat=String(j.productCategory||'').trim(),txt=String(j.productText||'').trim();
  if(can('product')&&(cat||txt)){let p=PRODUCTS.find(x=>x!==OTHER&&(x===cat||(txt&&txt.includes(x))));
    if(!p&&/除濕/.test(txt+cat))p='吊隱式除濕機';
    if(p){r.product=p;filled.push('product')}else{r.product=OTHER;r.productOther=txt||cat;filled.push('product','productOther')}}
  ['ambT','ambRH','outT','outRH','current','pipeT','voltage'].forEach(k=>{const v=num(j[k]);if(v!=null&&can('m-'+k)){r.meas[k]=String(v);filled.push('m-'+k)}});
  if(typeof j.compOn==='boolean'&&can('m-compOn'))r.meas.compOn=j.compOn;
  return filled}
async function runAI(blob,auto){const draft=S.draft;if(!draft||!aiReady())return;
  const setMsg=(t,bad)=>{draft._aiMsg=t;draft._aiBad=!!bad;const o=$('#ai-out');if(o&&S.draft===draft){o.textContent=t;o.className='ai-out'+(bad?' bad':'')}};
  draft._aiBusy=true;const b=$('#ai-run');if(b)b.disabled=true;setMsg('AI 正在讀服務單，約 5～20 秒…');
  try{if(!blob){const u=await photoURL(draft.formPhoto.path);blob=await (await fetch(u)).blob()}
    const j=await geminiRead(blob);const filled=applyAI(draft,j,auto);draft._aiBusy=false;
    if(S.draft!==draft)return;renderForm();
    filled.forEach(k=>{const el=k.startsWith('m-')?$('#'+k):$('#f-'+k)||document.querySelector(`[name="${k}"]`);const w=el&&el.closest('.fld');if(w)w.classList.add('flash')});
    setMsg(filled.length?`已自動填入 ${filled.length} 個欄位（淺藍底色），請對照服務單核對。`:'AI 沒有讀到可以填的內容，請手動填寫。')}
  catch(e){draft._aiBusy=false;setMsg(e.message||'辨識失敗',true);const b2=$('#ai-run');if(b2)b2.disabled=false}}

/* ---------- 專用連結登入（像展示台的分享連結：打開一次，這台裝置就記住） ---------- */
const NAME_KEY='wr_name';
function linkFor(t){return location.origin+location.pathname+'#k='+t}
function tokenFromText(txt){const m=String(txt||'').match(/(?:#|&|\?)k=([A-Za-z0-9_]+)/)||String(txt||'').trim().match(/^((?:github_pat|ghp)_[A-Za-z0-9_]+)$/);return m?m[1]:''}
async function login(token){S.token=token.trim();
  const me=await gh('/user');
  let repo;try{repo=await gh(REPO)}catch(e){if(e.status===404||e.status===403){const err=new Error('這組連結打不開案件資料庫，可能已被停用。請向管理者索取新的連結。');throw err}throw e}
  S.gh=me;S.canWrite=!!(repo.permissions&&repo.permissions.push);
  try{localStorage.setItem(TOKEN_KEY,S.token)}catch(e){}
  S.labelsP=S.canWrite?ensureLabels():Promise.resolve()}
function myName(){try{return localStorage.getItem(NAME_KEY)||''}catch(e){return ''}}
function startSession(){S.me={login:myName()};setMode()}
function logout(){try{localStorage.removeItem(TOKEN_KEY)}catch(e){}S.token='';S.me=null;S.gh=null;S.reports=[];S.loaded=false;setMode();renderLogin()}
function setMode(){const m=$('#mode');
  if(!S.me){m.innerHTML='';$('#nav').style.display='none';return}
  $('#nav').style.display='';$('#nav-new').style.display=S.canWrite?'':'none';
  m.innerHTML=`<span>${esc(S.me.login)}${S.canWrite?'':'・唯讀'}</span><button class="btn ghost sm" id="share">分享給同事</button><button class="btn ghost sm" id="me">設定</button>`;
  $('#share').onclick=shareDialog;$('#me').onclick=meDialog}
function shareDialog(){const link=linkFor(S.token);
  $('#modal').innerHTML=`<div class="mask"><div class="dlg" role="dialog" aria-modal="true"><h3>分享給同事</h3>
    <p style="margin:0">把這個連結用 LINE 私訊傳給同事。對方打開一次，他的手機或電腦就會記住，之後直接用，不用登入。</p>
    <textarea id="lnk" readonly style="min-height:90px;font-family:var(--font-mono);font-size:12px">${esc(link)}</textarea>
    <p class="muted" style="margin:0">拿到這個連結的人都能看和填寫案件，請只傳給同事，不要貼到群組或公開地方。若連結外流，管理者到 GitHub 刪掉金鑰、換一組新的就會失效。</p>
    <div class="row-btn"><button class="btn" id="m-no">關閉</button><button class="btn pri" id="m-copy">複製連結</button></div></div></div>`;
  $('#m-no').onclick=()=>$('#modal').innerHTML='';
  $('#m-copy').onclick=async()=>{try{await navigator.clipboard.writeText(link);toast('已複製，可以貼到 LINE')}catch(e){const t=$('#lnk');t.focus();t.select();toast('請按 Ctrl+C（手機長按）複製')}}}
function meDialog(){
  $('#modal').innerHTML=`<div class="mask"><div class="dlg" role="dialog" aria-modal="true"><h3>這台裝置的設定</h3>
    <div class="fld"><label for="nm">你的名字（會記在你填的案件上）</label><input id="nm" value="${esc(myName())}"></div>
    <div class="fld"><label for="gk">AI 辨識金鑰（Google Gemini，全部同事共用，設定一次即可）</label><input id="gk" type="password" autocomplete="off" placeholder="${aiReady()?'已設定，要更換才需重新貼上':'AIza 開頭的金鑰'}"></div>
    <p class="muted" style="margin:0">取得金鑰：用 Google 帳號登入 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>，按「Create API key」，複製貼上。</p>
    <div class="row-btn" style="justify-content:space-between"><button class="btn danger" id="m-out">讓這台裝置登出</button><span style="display:flex;gap:8px"><button class="btn" id="m-no">取消</button><button class="btn pri" id="m-ok">儲存</button></span></div></div></div>`;
  $('#m-no').onclick=()=>$('#modal').innerHTML='';
  $('#m-ok').onclick=async()=>{const v=$('#nm').value.trim();if(!v){toast('請填名字','bad');return}try{localStorage.setItem(NAME_KEY,v)}catch(e){}S.me.login=v;setMode();
    const k=$('#gk').value.trim();
    if(k){const ok=$('#m-ok');ok.disabled=true;ok.textContent='確認金鑰中…';
      try{const t=await fetch(`${GEM}/models?pageSize=1&key=${encodeURIComponent(k)}`);if(!t.ok)throw new Error('這組 AI 金鑰無法使用，請確認有完整複製。');
        S.settings=Object.assign({},S.settings,{geminiKey:k});delete S.settings.geminiModel;await saveSettings()}
      catch(e){ok.disabled=false;ok.textContent='儲存';toast(e.message||'金鑰儲存失敗','bad');return}}
    $('#modal').innerHTML='';toast(k?'已儲存，之後上傳服務單會自動辨識':'已更新');if(S.view==='form')renderForm()};
  $('#m-out').onclick=()=>{$('#modal').innerHTML='';logout()}}
function renderName(){S.view='name';
  $('#app').innerHTML=`<div class="login card"><h2>歡迎使用保固維修回報</h2>
    <p class="lead">先填你的名字，之後你填的案件和處理紀錄都會記上這個名字。只要填一次。</p>
    <form id="name-form" class="fld"><label for="nm1">你的名字</label><input id="nm1" placeholder="例：王小明" required><button class="btn pri" type="submit">開始使用</button></form></div>`;
  $('#nm1').focus();
  $('#name-form').onsubmit=async e=>{e.preventDefault();const v=$('#nm1').value.trim();if(!v)return;try{localStorage.setItem(NAME_KEY,v)}catch(e){}
    startSession();S.view=null;if(!location.hash||location.hash.startsWith('#k='))location.hash='#list';await refresh()}}
function renderLogin(msg){S.view='login';
  $('#app').innerHTML=`<div class="login card">
    <h2>保固維修回報</h2>
    <p class="lead">請用管理者傳給你的<b>專用連結</b>打開這個 App，打開一次這台裝置就會記住。</p>
    <p class="lead" style="margin-top:-6px">如果是從手機主畫面的圖示打開、看到這個畫面，請把那個連結整段複製，貼到下面：</p>
    <form id="login-form" class="fld">
      <label for="tok">專用連結</label>
      <input id="tok" autocomplete="off" placeholder="https://medole-warranty.github.io/warranty-app/#k=…" required>
      <button class="btn pri" id="login-btn" type="submit">開始使用</button>
    </form>
    <div id="login-msg" class="${msg?'dx bad':''}">${esc(msg||'')}</div>
    <p class="fine">管理者第一次使用：把 GitHub 金鑰（github_pat_ 開頭）直接貼在上面即可，進去後按右上角「分享給同事」產生連結。</p>
  </div>`;
  $('#login-form').onsubmit=async e=>{e.preventDefault();const t=tokenFromText($('#tok').value);const box=$('#login-msg');
    if(!t){box.className='dx bad';box.textContent='這不是正確的專用連結，請整段複製再貼一次。';return}
    const b=$('#login-btn');b.disabled=true;b.textContent='確認中…';
    try{await enter(t)}catch(err){S.token='';box.className='dx bad';box.textContent=err.message;b.disabled=false;b.textContent='開始使用'}}}
async function enter(t){await login(t);await loadSettings();
  if(!myName())return renderName();
  startSession();S.view=null;if(!location.hash||location.hash.startsWith('#k='))location.hash='#list';await refresh()}

/* ---------- init + router ---------- */
{const bl=$('#brand-line');if(bl)bl.textContent=`${CFG.fromCompany}／${CFG.branchName} → ${CFG.toCompany}`}
(async function init(){
  const fromLink=tokenFromText(location.hash);
  if(fromLink)history.replaceState(null,'',location.pathname+location.search+'#list');
  let t=fromLink;if(!t){try{t=localStorage.getItem(TOKEN_KEY)||''}catch(e){}}
  if(!t){setMode();renderLogin();return}
  try{await enter(t)}catch(e){S.token='';setMode();renderLogin(e.status===401?'這組連結已失效，請向管理者索取新的連結。':e.message)}
})();
window.addEventListener('hashchange',()=>{const t=tokenFromText(location.hash);
  if(t){history.replaceState(null,'',location.pathname+location.search+'#list');enter(t).catch(e=>{S.token='';S.me=null;setMode();renderLogin(e.message)});return}
  if(S.me)route()});
window.addEventListener('resize',()=>fitPreview());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.me&&S.view!=='form')refresh(true)});
function notFound(){S.view='missing';$('#app').innerHTML='<div class="card empty"><p>找不到這筆案件。</p><a class="btn" href="#list">回到案件總覽</a></div>'}
function route(){if(!S.me)return renderLogin();const h=location.hash||'#list';
  $('#nav-list').classList.toggle('on',h==='#list'||h.startsWith('#r-'));
  if(!S.loaded){$('#app').innerHTML='<div class="empty">載入案件中…</div>';return}
  if(h==='#new'){if(!S.canWrite){location.hash='#list';return}
    if(!(S.view==='form'&&S.editingNo===null&&S.draft)){S.draft=blankReport();S.editingNo=null;S.formBlob=null}
    S.view='form';return renderForm()}
  if(h.startsWith('#edit-')){const n=+h.slice(6);const r=S.reports.find(x=>x.number===n);if(!r)return notFound();
    if(!(S.view==='form'&&S.editingNo===n&&S.draft)){S.draft=clone(r);S.editingNo=n;S.formBlob=null}
    S.view='form';return renderForm()}
  S.draft=null;S.editingNo=null;
  if(h.startsWith('#r-')){const r=S.reports.find(x=>x.number===+h.slice(3));if(!r)return notFound();S.view='detail';return renderDetail(r)}
  S.view='list';renderList()}

/* ---------- list ---------- */
function renderList(){
  const counts={};STATUSES.forEach(s=>counts[s]=0);S.reports.forEach(r=>counts[r.status]=(counts[r.status]||0)+1);
  const q=S.q.trim().toLowerCase();
  const rows=S.reports.filter(r=>(S.filter==='全部'||r.status===S.filter)&&(!q||[r.no,r.customer,r.model,r.serial,r.fault,r.address].join(' ').toLowerCase().includes(q)));
  const chip=(k,n)=>`<button class="chip${S.filter===k?' on':''}" data-filter="${esc(k)}"><b>${n}</b><span>${esc(k)}</span></button>`;
  $('#app').innerHTML=`${S.note?`<div class="note">${esc(S.note)}</div>`:''}
  <div class="list-head"><h2>案件總覽</h2>
    <input class="search" id="q" type="search" placeholder="搜尋單號、客戶、機型、機號…" value="${esc(S.q)}">
    <button class="btn" id="reload">重新整理</button><button class="btn" id="csv">匯出 CSV</button></div>
  <div class="chips">${chip('全部',S.reports.length)}${STATUSES.map(s=>chip(s,counts[s])).join('')}</div>
  <div class="table">
    ${rows.length?`<div class="row hd"><div>服務單號</div><div>登記日</div><div>客戶／案場</div><div>產品／機型／機號</div><div>故障情況</div><div>申請事項</div><div>照片</div><div>狀態</div></div>`+rows.map(r=>{
      return `<div class="row" data-open="${r.number}" tabindex="0">
      <div class="cell c-no"><span class="no">${esc(r.no||'—')}</span><span class="sub">${esc(r.warranty)}</span></div>
      <div class="cell c-dt mono">${roc(r.regDate)}</div>
      <div class="cell c-cu">${esc(r.customer||'（未填客戶）')}${r.address?`<span class="sub">${esc(r.address)}</span>`:''}</div>
      <div class="cell c-mo"><span>${esc(productLabel(r))}</span> <span class="mono">${esc(r.model)}</span><span class="sub mono">${esc(r.serial)}</span></div>
      <div class="cell c-fa">${esc(r.fault)}</div>
      <div class="cell c-rq">${esc(r.request)}${r.urgency==='急件'?' <span class="pill s-需補件">急件</span>':''}</div>
      <div class="cell c-ph">${r.photos.length} 張</div>
      <div class="cell c-st"><span class="pill s-${esc(r.status)}">${esc(r.status)}</span><span class="sub">${rocDT(r.updatedAt)}</span></div></div>`}).join('')
    :`<div class="empty"><p>${S.reports.length?'沒有符合條件的案件。':'還沒有回報案件。上傳服務單和現場照片，就能產生給總公司的回報單。'}</p>${S.canWrite&&!S.reports.length?'<a class="btn pri" href="#new">＋ 新增第一筆回報</a>':''}</div>`}
  </div>`;
  $('#q').addEventListener('input',e=>{S.q=e.target.value;const pos=e.target.selectionStart;renderList();const n=$('#q');n.focus();n.setSelectionRange(pos,pos)});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{S.filter=b.dataset.filter;renderList()});
  document.querySelectorAll('[data-open]').forEach(el=>{const go=()=>location.hash='#r-'+el.dataset.open;el.onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()}});
  $('#reload').onclick=async()=>{$('#reload').disabled=true;await refresh();toast('已更新')};
  $('#csv').onclick=()=>exportCSV(rows)}

/* ---------- form ---------- */
function F(label,key,opt={}){const v=S.draft[key]??'';const id='f-'+key;const req=opt.req?'<span class="req"> *</span>':'';let input;
  if(opt.type==='textarea')input=`<textarea id="${id}" data-f="${key}" placeholder="${esc(opt.ph||'')}">${esc(v)}</textarea>`;
  else if(opt.options)input=`<select id="${id}" data-f="${key}">${opt.options.map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  else input=`<input id="${id}" data-f="${key}" type="${opt.type||'text'}" value="${esc(v)}" placeholder="${esc(opt.ph||'')}"${opt.mono?' class="mono"':''}>`;
  return `<div class="fld ${opt.cls||''}"><label for="${id}">${esc(label)}${req}</label>${input}</div>`}
function seg(name,list,val){return `<div class="seg">${list.map(q=>`<label><input type="radio" name="${name}" data-f="${name}" value="${esc(q)}"${val===q?' checked':''}>${esc(q)}</label>`).join('')}</div>`}
function renderForm(){const r=S.draft;const isNew=S.editingNo===null;
  $('#app').innerHTML=`<div class="form-wrap"><div id="form">
  <div class="card"><h2><span class="n">01</span>服務單影本<small>拍下紙本服務單，總公司可直接看原件</small></h2>
    <div class="formphoto"><div class="thumb" id="fp-thumb">${r.formUploading?'上傳中…':r.formPhoto?imgTag(r.formPhoto):'尚未上傳'}</div>
      <div class="fp-side"><label class="drop" id="fp-drop"><input type="file" accept="image/*" id="fp-file">${r.formPhoto?'重新拍攝／更換服務單照片':'點這裡拍照或選擇服務單照片'}</label>
        ${aiReady()?`<div class="ai-row"><button class="btn sm" id="ai-run" type="button"${r.formPhoto&&!r._aiBusy?'':' disabled'}>重新辨識</button><span class="ai-out${r._aiBad?' bad':''}" id="ai-out">${esc(r._aiMsg||'上傳服務單後，AI 會自動讀出產品、機型、機號、故障情況等並填入。')}</span></div>`
          :`<div class="ai-out" id="ai-out">還沒設定 AI 辨識，請管理者到右上角「設定」貼上 Gemini 金鑰。</div>`}</div></div></div>
  <div class="card"><h2><span class="n">02</span>基本資料<small>與服務單相同欄位</small></h2><div class="grid">
    ${F('服務單號','no',{mono:true,ph:'例：003518'})}${F('登記日期','regDate',{type:'date'})}${F('服務日期','serviceDate',{type:'date'})}${F('技術員','tech',{ph:'姓名'})}
    ${F('客戶／案場','customer',{cls:'w2',ph:'例：中與'})}${F('聯絡人','contact')}${F('電話','phone',{type:'tel'})}
    ${F('地址','address',{cls:'w4'})}</div></div>
  <div class="card"><h2><span class="n">03</span>產品資料</h2><div class="grid">
    ${F('產品','product',{req:true,cls:'w2',options:PRODUCTS})}${r.product===OTHER?F('產品／零件名稱','productOther',{cls:'w2',ph:'例：排水泵、主機板、渦輪葉片'}):''}${F('機型','model',{mono:true,ph:'例：MD-70LB'})}${F('機號','serial',{mono:true,ph:'例：202602352'})}${F('保卡號碼','warrantyCard',{mono:true})}
    ${F('安裝年月','installDate',{type:'month'})}${F('購買年月','purchaseDate',{type:'month'})}
    <div class="fld w2"><label>保固狀態</label>${seg('warranty',WARRANTY,r.warranty)}</div></div></div>
  <div class="card"><h2><span class="n">04</span>故障與現場狀況</h2><div class="grid">
    ${F('故障情況','fault',{req:true,cls:'w2',ph:'例：漏冷媒'})}${F('處理方式','handling',{options:HANDLING})}${F('和客戶約定事項','agreement',{ph:'例：更換新設備'})}
    ${measList(r).length?`<div class="fld w4"><label>現場量測<span class="muted">（依產品顯示，有量再填）</span></label></div>`+measList(r).map(m=>`<div class="fld"><label for="m-${m.k}">${m.l}</label><div class="unit"><input id="m-${m.k}" data-m="${m.k}" inputmode="decimal" value="${esc(r.meas[m.k])}"><span>${m.u}</span></div></div>`).join(''):`<div class="fld w4 muted">${esc(productLabel(r))}不需要量測數據。</div>`}
    ${profileOf(r).comp?`<div class="fld w4"><div class="seg"><label><input type="checkbox" id="m-compOn" data-m="compOn"${r.meas.compOn?' checked':''}>以上皆在壓縮機啟動下量測</label></div></div>`:''}
    ${F('檢修情況（技術員說明）','inspection',{type:'textarea',cls:'w4',ph:'例：出風濕度為 61%（與環境相同），管溫約 27°C（與現場相同）'})}
  </div><div class="hint" id="dx"></div></div>
  <div class="card"><h2><span class="n">05</span>現場照片<small>每張選類別並寫一句說明，報告會依序排版</small></h2>
    <div class="photos" id="photos"></div>
    <label class="drop" id="ph-drop"><input type="file" accept="image/*" multiple id="ph-file">＋ 拍照或加入現場照片（可一次選多張）</label></div>
  <div class="card"><h2><span class="n">06</span>申請總公司</h2><div class="grid">
    <div class="fld w4"><label>申請事項</label>${seg('request',REQUESTS,r.request)}</div>
    ${F('需要的零件／新機型號','parts',{cls:'w2',ph:'例：MD-70LB 新機一台'})}
    <div class="fld w2"><label>急迫性</label>${seg('urgency',['一般','急件'],r.urgency)}</div></div></div>
  </div>
  <aside class="side">
    <div class="card"><h2>建議附上的照片<small>依產品而定，都不是必附</small></h2><ul class="check" id="check"></ul></div>
    <div class="card actions">
      <button class="btn pri" id="send">${isNew||r.status==='草稿'?'送出給總公司':r.status==='需補件'?'補件後重新送出':'儲存並更新'}</button>
      <button class="btn" id="draft">${isNew||r.status==='草稿'?'先存草稿':'只儲存'}</button>
      <a class="btn ghost" href="${isNew?'#list':'#r-'+S.editingNo}">取消</a>
    </div></aside></div>`;
  hydrate($('#app'));renderPhotos();updateLive();
  const form=$('#form');form.addEventListener('input',onFormInput);form.addEventListener('change',onFormInput);
  bindDrop($('#fp-drop'),$('#fp-file'),files=>addFormPhoto(files[0]));
  const air=$('#ai-run');if(air)air.onclick=()=>runAI(S.formBlob,false);
  bindDrop($('#ph-drop'),$('#ph-file'),files=>addPhotos(files));
  $('#send').onclick=()=>save(true);$('#draft').onclick=()=>save(false)}
function onFormInput(e){const t=e.target;const r=S.draft;if(!r)return;
  if(t.dataset.f){if(t.type==='radio'){if(t.checked)r[t.dataset.f]=t.value}else r[t.dataset.f]=t.value;(r._touched=r._touched||{})[t.dataset.f]=1;
    if(t.dataset.f==='product'&&e.type==='change'){renderForm();return}}
  else if(t.dataset.m){r.meas[t.dataset.m]=t.type==='checkbox'?t.checked:t.value.trim();(r._touched=r._touched||{})['m-'+t.dataset.m]=1}
  else if(t.dataset.pi!=null){const p=r.photos[+t.dataset.pi];if(p)p[t.dataset.pk]=t.value}
  updateLive()}
function updateLive(){const r=S.draft;const dx=diag(r);
  $('#dx').innerHTML=!profileOf(r).diag?'':dx.length?dx.map(d=>`<div class="dx ${d.lv}"><b>${d.lv==='bad'?'異常':'正常'}</b><span>${esc(d.t)}</span></div>`).join('')+'<div class="muted">系統依量測值自動提示，僅供參考，報告會一併附上。</div>':'<div class="muted">填入環境與出風濕度、管溫後，會自動提示是否有除濕效果。</div>';
  $('#check').innerHTML=suggested(r).map(i=>`<li class="${i.done?'done':''}"><span class="bx">${i.done?'✓':''}</span>${esc(i.k)}</li>`).join('')}
function renderPhotos(){const r=S.draft;const el=$('#photos');
  el.innerHTML=r.photos.map((p,i)=>`<div class="ph"><div class="im">${imgTag(p)}${p.uploading?'<div class="up">上傳中…</div>':''}<button class="x" data-del="${i}" aria-label="移除照片">×</button></div>
    <div class="bd"><select data-pi="${i}" data-pk="cat" aria-label="照片類別">${[...new Set([...profileOf(r).photos,p.cat,'其他'])].map(c=>`<option${c===p.cat?' selected':''}>${esc(c)}</option>`).join('')}</select>
    <input data-pi="${i}" data-pk="caption" value="${esc(p.caption||'')}" placeholder="說明，例：壓縮機啟動後出風濕度約 62%" aria-label="照片說明"></div></div>`).join('');
  hydrate(el);
  el.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{r.photos.splice(+b.dataset.del,1);renderPhotos();updateLive()})}
function bindDrop(zone,input,cb){input.onchange=()=>{if(input.files.length)cb([...input.files]);input.value=''};
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('over')});
  zone.addEventListener('dragleave',()=>zone.classList.remove('over'));
  zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('over');const f=[...e.dataTransfer.files].filter(f=>f.type.startsWith('image/'));if(f.length)cb(f)})}
async function addFormPhoto(file){if(!file)return;const draft=S.draft;draft.formUploading=true;$('#fp-thumb').innerHTML='上傳中…';S.formBlob=file;
  if(aiReady())runAI(file,true);
  try{const ref=await storePhoto(file,draft.key,'服務單 '+(draft.no||''),2200);draft.formPhoto=ref;
    if(S.draft===draft){$('#fp-thumb').innerHTML=imgTag(ref);const ab=$('#ai-run');if(ab&&!draft._aiBusy)ab.disabled=false;updateLive()}}
  catch(e){toast('服務單上傳失敗：'+e.message,'bad');if(S.draft===draft)$('#fp-thumb').innerHTML=draft.formPhoto?imgTag(draft.formPhoto):'尚未上傳'}
  finally{draft.formUploading=false;if(S.draft===draft&&$('#fp-thumb')&&$('#fp-thumb').textContent==='上傳中…')$('#fp-thumb').innerHTML=draft.formPhoto?imgTag(draft.formPhoto):'尚未上傳'}}
async function addPhotos(files){const draft=S.draft;
  const items=files.map(f=>{const have=new Set(draft.photos.map(p=>p.cat));const cat=profileOf(draft).photos.find(k=>!have.has(k))||'其他';
    const p={cat,caption:'',uploading:true,preview:URL.createObjectURL(f)};draft.photos.push(p);return [f,p]});
  if(S.draft===draft){renderPhotos();updateLive()}
  for(const [f,p] of items){try{const ref=await storePhoto(f,draft.key,p.cat,1600);p.path=ref.path}
    catch(e){toast('照片上傳失敗：'+e.message,'bad');draft.photos.splice(draft.photos.indexOf(p),1)}
    p.uploading=false;const keep=p.preview;delete p.preview;if(S.draft===draft)renderPhotos();setTimeout(()=>URL.revokeObjectURL(keep),5000)}}

async function save(send){const r=S.draft;
  if(r.formUploading||r.photos.some(p=>p.uploading)){toast('照片還在上傳，請稍等幾秒再存。','bad');return}
  if(send){const need=[['fault','故障情況']].filter(([k])=>!String(r[k]||'').trim());
    if(need.length){toast('送出前請先填：'+need.map(x=>x[1]).join('、'),'bad');const el=$('#f-'+need[0][0]);if(el)el.focus();return}}
  const btns=[$('#send'),$('#draft')];btns.forEach(b=>b.disabled=true);
  try{await S.labelsP;const now=new Date().toISOString();
    const obj=clone(r);obj.photos=obj.photos.map(({preview,uploading,...p})=>p);Object.keys(obj).forEach(k=>{if(k.startsWith('_'))delete obj[k]});delete obj.number;delete obj.url;delete obj.issueUser;delete obj.formUploading;
    let prev=null;
    if(S.editingNo!==null){const is=await gh(`${REPO}/issues/${S.editingNo}`);prev=fromIssue(is)}
    let status=prev?prev.status:'草稿';
    if(send&&(status==='草稿'||status==='需補件'))status='已送出';
    obj.status=status;obj.updatedAt=now;
    if(prev){obj.hqNote=prev.hqNote;obj.log=prev.log;obj.createdAt=prev.createdAt;obj.createdBy=prev.createdBy}
    else{obj.createdAt=now;obj.createdBy=S.me.login;obj.log=[]}
    obj.log=obj.log.slice(-40);
    obj.log.push({t:now,by:S.me.login,s:status,n:!prev?(send?'中部送出回報':'建立草稿'):(prev.status!==status?(prev.status==='需補件'?'中部已補件，重新送出':'中部送出回報'):'中部更新內容')});
    const payload={title:issueTitle(obj),body:issueBody(obj),labels:labelsFor(obj),state:status==='已結案'?'closed':'open'};
    let is;
    if(prev)is=await gh(`${REPO}/issues/${S.editingNo}`,{method:'PATCH',body:payload});
    else{is=await gh(`${REPO}/issues`,{method:'POST',body:{title:payload.title,body:payload.body,labels:payload.labels}})}
    if(prev&&prev.status!==status)gh(`${REPO}/issues/${is.number}/comments`,{method:'POST',body:{body:`**狀態：${status}**　${obj.log[obj.log.length-1].n}（${S.me.login}）`}}).catch(()=>{});
    const nr=fromIssue(is);const i=S.reports.findIndex(x=>x.number===nr.number);if(i>=0)S.reports[i]=nr;else S.reports.unshift(nr);
    toast(send?'已送出給總公司':'已儲存');S.view=null;S.draft=null;location.hash='#r-'+nr.number}
  catch(e){btns.forEach(b=>b.disabled=false);toast('儲存失敗：'+e.message,'bad')}}

/* ---------- report pages ---------- */
function pages(r){const dx=diag(r);const ph=r.photos;const ml=measList(r);const hasM=ml.some(m=>num(r.meas[m.k])!=null);
  const groups=[];for(let i=0;i<ph.length;i+=4)groups.push(ph.slice(i,i+4));
  const total=1+(r.formPhoto?1:0)+groups.length;let pn=0;
  const foot=()=>`<div class="pg-foot"><span>服務單號 ${esc(r.no||'—')}・${esc(r.customer)}・${esc(r.model)}</span><span>第 ${++pn} / ${total} 頁</span></div>`;
  const head=t=>`<div class="pg-head"><div><div class="pg-co">${esc(CFG.fromCompany)}／${esc(CFG.branchName)}　→　${esc(CFG.toCompany)}</div><h1>${t}</h1><div class="pg-sub">登記 ${roc(r.regDate)||'—'}　服務 ${roc(r.serviceDate)||'—'}　回報 ${rocDT(r.updatedAt)||'—'}</div></div>
    <div class="pg-no"><span>服務單號</span><b>${esc(r.no||'——')}</b><span class="pg-tag">${esc(r.warranty)}・${esc(r.status)}</span></div></div>`;
  const mv=k=>{const v=num(r.meas[k]);return v==null?'<b style="color:#9aa1b1">—</b>':`<b>${v}</b>`};
  const out=[`<div class="pg">${head('保固維修回報單')}
    <table class="kv"><tbody>
      <tr><th>客戶／案場</th><td>${esc(r.customer)}</td><th>聯絡人／電話</th><td>${esc([r.contact,r.phone].filter(Boolean).join('　'))}</td></tr>
      <tr><th>地址</th><td colspan="3">${esc(r.address)}</td></tr>
      <tr><th>產品／機型</th><td>${esc(productLabel(r))}　<span class="mono">${esc(r.model)}</span></td><th>機號</th><td class="mono">${esc(r.serial)}</td></tr>
      <tr><th>安裝年月</th><td class="mono">${roc(r.installDate)}</td><th>購買年月／保卡</th><td class="mono">${esc([roc(r.purchaseDate),r.warrantyCard].filter(Boolean).join('　'))}</td></tr>
      <tr><th>故障情況</th><td colspan="3">${esc(r.fault)}</td></tr>
      <tr><th>處理方式</th><td>${esc(r.handling)}</td><th>和客戶約定事項</th><td>${esc(r.agreement)}</td></tr>
    </tbody></table>
    ${hasM?`<h3>現場量測 <small>${profileOf(r).comp?(r.meas.compOn?'以上皆在壓縮機啟動下量測':'量測條件未註明壓縮機運轉'):''}</small></h3>
    <div class="mgrid">${ml.map(m=>`<div><span>${m.l}</span>${mv(m.k)}<i>${m.u}</i></div>`).join('')}</div>`:''}
    ${dx.length?`<div class="dxs">${dx.map(d=>`<div class="dx ${d.lv}"><b>${d.lv==='bad'?'異常':'正常'}</b>　${esc(d.t)}</div>`).join('')}</div>`:''}
    <h3>檢修情況</h3><p class="insp">${esc(r.inspection||'（未填寫）')}</p>
    <h3>申請總公司</h3>
    <div class="reqbox"><b>${esc(r.request)}</b>${r.urgency==='急件'?'<span class="urg">急件</span>':''}${r.parts?`<span>零件／新機：${esc(r.parts)}</span>`:''}</div>
    ${r.hqNote?`<h3>總公司回覆</h3><div class="hqbox">${esc(r.hqNote)}</div>`:''}
    <div class="pg-meta">技術員：${esc(r.tech||'—')}　填報人：${esc(r.createdBy||'—')}　附件：服務單 ${r.formPhoto?1:0} 張、現場照片 ${ph.length} 張</div>
    ${foot()}</div>`];
  if(r.formPhoto)out.push(`<div class="pg">${head('附件一・服務單影本')}<div class="pg-scan">${imgTag(r.formPhoto)}</div>${foot()}</div>`);
  groups.forEach((g,gi)=>out.push(`<div class="pg">${head(`附件${r.formPhoto?'二':'一'}・現場照片${groups.length>1?`（${gi+1}）`:''}`)}
    <div class="pg-photos">${g.map((p,j)=>`<div class="pg-photo"><div class="fr">${imgTag(p)}</div><div class="cap"><em>${pad(gi*4+j+1)}</em><b>${esc(p.cat)}</b>${esc(p.caption||'')}</div></div>`).join('')}</div>${foot()}</div>`));
  return out}

/* ---------- detail ---------- */
function renderDetail(r){
  const keepNote=$('#hq-note')?$('#hq-note').value:null,keepSt=$('#hq-status')?$('#hq-status').value:null;
  $('#app').innerHTML=`${S.note?`<div class="note">${esc(S.note)}</div>`:''}<div class="detail">
    <div class="pv" id="pv">${pages(r).map(p=>`<div class="pv-wrap">${p}</div>`).join('')}</div>
    <aside class="side">
      <div class="card"><h2>案件狀態</h2>
        <div class="pills"><span class="pill s-${esc(r.status)}">${esc(r.status)}</span>${r.urgency==='急件'?'<span class="pill s-需補件">急件</span>':''}</div>
        <div class="meta"><span>填報人：${esc(r.createdBy||'—')}</span><span>建立：${rocDT(r.createdAt)}</span><span>更新：${rocDT(r.updatedAt)}</span><span>案件編號：#${r.number}</span></div>
      </div>
      ${S.canWrite?`<div class="card"><h2>總公司處理<small>更新狀態並留言給中部</small></h2>
        <div class="fld" style="margin-bottom:10px"><label for="hq-status">狀態</label><select id="hq-status">${STATUSES.map(s=>`<option${s===(keepSt||r.status)?' selected':''}>${s}</option>`).join('')}</select></div>
        <div class="fld" style="margin-bottom:10px"><label for="hq-note">回覆意見（會印在報告上）</label><textarea id="hq-note" placeholder="例：同意更換新機，請於 11/30 前寄回舊機">${esc(keepNote??r.hqNote)}</textarea></div>
        <button class="btn pri wide" id="hq-save">更新狀態</button></div>`:''}
      <div class="card actions">
        <button class="btn pri" id="pdf">下載 PDF 報告</button>
        <button class="btn" id="copy">複製文字摘要（貼 LINE／Email）</button>
        ${S.canWrite?`<a class="btn" href="#edit-${r.number}">編輯回報內容</a>`:''}
      </div>
      <div class="card"><h2>處理紀錄</h2><ul class="log">${r.log.slice().reverse().map(l=>`<li><time>${rocDT(l.t)}</time>　<span class="pill s-${esc(l.s)}">${esc(l.s)}</span><p>${esc(l.n||'')}${l.by?`　— ${esc(l.by)}`:''}</p></li>`).join('')||'<li>尚無紀錄</li>'}</ul></div>
    </aside></div>`;
  hydrate($('#pv'));fitPreview();
  $('#pdf').onclick=()=>exportPDF(r);$('#copy').onclick=()=>copySummary(r);
  const h=$('#hq-save');if(h)h.onclick=()=>hqUpdate(r)}
function fitPreview(){const pv=$('#pv');if(!pv)return;pv.style.setProperty('--s',Math.min(1,pv.clientWidth/794).toFixed(4))}
async function hqUpdate(r){const st=$('#hq-status').value,note=$('#hq-note').value.trim();
  if(st===r.status&&note===(r.hqNote||'')){toast('沒有變更');return}
  const btn=$('#hq-save');btn.disabled=true;
  try{const cur=fromIssue(await gh(`${REPO}/issues/${r.number}`));if(!cur)throw new Error('這筆 Issue 的資料區塊被改壞了，請到 GitHub 檢查。');
    const now=new Date().toISOString();const changed=st!==cur.status;const noteChanged=note!==(cur.hqNote||'');
    cur.status=st;cur.hqNote=note;cur.updatedAt=now;
    const msg=[changed?`狀態改為「${st}」`:'',noteChanged&&note?'總公司：'+note:''].filter(Boolean).join('；')||'更新';
    cur.log=cur.log.slice(-40);cur.log.push({t:now,by:S.me.login,s:st,n:msg});
    const obj=clone(cur);['number','url','issueUser'].forEach(k=>delete obj[k]);
    const is=await gh(`${REPO}/issues/${r.number}`,{method:'PATCH',body:{title:issueTitle(obj),body:issueBody(obj),labels:labelsFor(obj),state:st==='已結案'?'closed':'open'}});
    gh(`${REPO}/issues/${r.number}/comments`,{method:'POST',body:{body:`**狀態：${st}**${note&&noteChanged?`\n\n${note}`:''}\n\n— ${S.me.login}`}}).catch(()=>{});
    const nr=fromIssue(is);const i=S.reports.findIndex(x=>x.number===nr.number);if(i>=0)S.reports[i]=nr;
    toast('已更新狀態');$('#hq-note').value=note;renderDetail(nr)}
  catch(e){btn.disabled=false;toast('更新失敗：'+e.message,'bad')}}

/* ---------- outputs ---------- */
function summary(r){const m=r.meas;const mm=[];
  if(m.outT||m.outRH)mm.push(`出風 ${[m.outT&&m.outT+'°C',m.outRH&&m.outRH+'%'].filter(Boolean).join('／')}`);
  if(m.ambT||m.ambRH)mm.push(`環境 ${[m.ambT&&m.ambT+'°C',m.ambRH&&m.ambRH+'%'].filter(Boolean).join('／')}`);
  if(m.current)mm.push(`電流 ${m.current}A`);if(m.pipeT)mm.push(`管溫 ${m.pipeT}°C`);if(m.voltage)mm.push(`電壓 ${m.voltage}V`);
  const dx=diag(r).filter(d=>d.lv==='bad').map(d=>'・'+d.t);
  return [`【保固維修回報】${CFG.fromCompany}／${CFG.branchName} → ${CFG.toCompany}`,`服務單號：${r.no}｜登記 ${roc(r.regDate)}｜${r.warranty}`,`客戶：${r.customer}${r.address?'（'+r.address+'）':''}`,
    `產品：${productLabel(r)}${r.model||r.serial?`｜機型／機號：${r.model||'—'}／${r.serial||'—'}`:''}${r.installDate?'（'+roc(r.installDate)+' 安裝）':''}`,`故障：${r.fault}`,
    mm.length?`量測${profileOf(r).comp&&m.compOn?'（壓縮機運轉中）':''}：${mm.join('，')}`:'',...dx,
    r.inspection?`檢修：${r.inspection.replace(/\n+/g,'；')}`:'',`申請：${r.request}${r.urgency==='急件'?'（急件）':''}${r.parts?'－'+r.parts:''}`,
    `附件：服務單 ${r.formPhoto?1:0} 張、現場照片 ${r.photos.length} 張`,`狀態：${r.status}`,`連結：${location.href.split('#')[0]}#r-${r.number}`].filter(Boolean).join('\n')}
async function copySummary(r){const t=summary(r);
  try{await navigator.clipboard.writeText(t);toast('已複製，可直接貼到 LINE 或 Email')}
  catch(e){$('#modal').innerHTML=`<div class="mask"><div class="dlg"><h3>文字摘要</h3><textarea id="sumtxt" readonly>${esc(t)}</textarea><div class="row-btn"><button class="btn" id="m-no">關閉</button></div></div></div>`;
    const ta=$('#sumtxt');ta.focus();ta.select();$('#m-no').onclick=()=>$('#modal').innerHTML=''}}
async function exportPDF(r){const btn=$('#pdf');if(!window.jspdf||!window.html2canvas){toast('PDF 元件載入失敗，請重新整理頁面。','bad');return}
  btn.disabled=true;const label=btn.textContent;btn.textContent='產生 PDF 中…';const off=$('#off');
  try{await ensurePhotos(r);off.innerHTML=pages(r).join('');
    await Promise.all([...off.querySelectorAll('img')].map(i=>i.complete?null:new Promise(res=>{i.onload=i.onerror=res})));
    if(document.fonts&&document.fonts.ready)await document.fonts.ready;
    const pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});const pgs=[...off.querySelectorAll('.pg')];
    for(let i=0;i<pgs.length;i++){const c=await window.html2canvas(pgs[i],{scale:2,backgroundColor:'#ffffff',logging:false});
      if(i)pdf.addPage();pdf.addImage(c.toDataURL('image/jpeg',0.88),'JPEG',0,0,210,297)}
    saveFile(pdf.output('blob'),`保固維修回報_${r.no||'未編號'}_${(r.customer||'').replace(/[\\/:*?"<>|]/g,'')}.pdf`);toast('PDF 已下載')}
  catch(e){toast('PDF 產生失敗：'+(e&&e.message||''),'bad')}
  finally{off.innerHTML='';btn.disabled=false;btn.textContent=label}}
function exportCSV(rows){const cols=[['服務單號','no'],['狀態','status'],['登記日期',r=>roc(r.regDate)],['服務日期',r=>roc(r.serviceDate)],['客戶','customer'],['地址','address'],['產品',r=>productLabel(r)],['機型','model'],['機號','serial'],['安裝年月',r=>roc(r.installDate)],['保固','warranty'],['故障情況','fault'],['處理方式','handling'],['環境溫度',r=>r.meas.ambT],['環境濕度',r=>r.meas.ambRH],['出風溫度',r=>r.meas.outT],['出風濕度',r=>r.meas.outRH],['運轉電流',r=>r.meas.current],['管溫',r=>r.meas.pipeT],['檢修情況','inspection'],['申請事項','request'],['零件／新機','parts'],['急迫性','urgency'],['總公司回覆','hqNote'],['照片數',r=>r.photos.length],['技術員','tech'],['填報人','createdBy'],['更新時間',r=>rocDT(r.updatedAt)],['App 連結',r=>location.href.split('#')[0]+'#r-'+r.number]];
  const cell=v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const csv='﻿'+[cols.map(c=>c[0]).join(','),...rows.map(r=>cols.map(c=>cell(typeof c[1]==='function'?c[1](r):r[c[1]])).join(','))].join('\r\n');
  saveFile(new Blob([csv],{type:'text/csv;charset=utf-8'}),`保固維修案件_${today()}.csv`);toast('CSV 已下載')}

/* ---------- 安裝成 App ---------- */
(function installSetup(){
  if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
  const btn=$('#install');if(!btn)return;
  const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  if(standalone)return;
  const ua=navigator.userAgent;
  const isIOS=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const isMacSafari=!isIOS&&/Macintosh/.test(ua)&&/Safari/.test(ua)&&!/Chrome|Chromium|Edg|Firefox/.test(ua);
  let deferred=null;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;btn.hidden=false});
  window.addEventListener('appinstalled',()=>{btn.hidden=true;deferred=null;toast('已安裝，之後可從桌面或主畫面開啟')});
  if(isIOS||isMacSafari)btn.hidden=false;
  else setTimeout(()=>{if(!deferred)btn.hidden=false},3000);   // 瀏覽器沒提供安裝視窗時，按下去顯示手動步驟
  const share='<span class="shot"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 10V2M5 4.5 8 1.5l3 3M4 7H3v7h10V7h-1" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  function guide(){const steps=isIOS?[
      '請用 <b>Safari</b> 開啟這個網址（LINE 或其他 App 內開的話，先點右上角選「用 Safari 開啟」）',
      `點畫面下方（iPad 在右上方）的分享按鈕 ${share}`,
      '往下滑，點「<b>加入主畫面</b>」',
      '點右上角「<b>新增</b>」，主畫面就會出現「保固回報」圖示']
    :isMacSafari?['點 Safari 選單列的「檔案」','選「<b>加入 Dock</b>」','按「加入」，Dock 和應用程式資料夾就會出現「保固回報」']
    :/Android/.test(ua)?['請用 <b>Chrome</b> 開啟這個網址','點右上角「⋮」選單','點「<b>安裝應用程式</b>」或「加到主畫面」','按「安裝」，主畫面就會出現「保固回報」圖示']
    :['請用 <b>Chrome</b> 或 <b>Edge</b> 開啟這個網址','點網址列右側的安裝圖示，或右上角「⋮」選單 →「投放、儲存及分享」→「<b>安裝網頁為應用程式</b>」','按「安裝」，桌面和開始選單就會出現「保固回報」'];
    $('#modal').innerHTML=`<div class="mask"><div class="dlg" role="dialog" aria-modal="true"><h3>安裝成 App</h3><ol>${steps.map(s=>`<li>${s}</li>`).join('')}</ol>
      <p class="muted" style="margin:0">${isIOS||isMacSafari?"安裝後第一次從圖示開啟，要再貼一次權杖（Apple 裝置的 App 和瀏覽器分開記錄），之後就會記住。":"安裝後點圖示就會用獨立視窗開啟，登入狀態會保留。"}</p><div class="row-btn"><button class="btn" id="m-no">知道了</button></div></div></div>`;
    $('#m-no').onclick=()=>$('#modal').innerHTML=''}
  btn.onclick=async()=>{if(deferred){deferred.prompt();const r=await deferred.userChoice.catch(()=>null);deferred=null;if(r&&r.outcome==='accepted')btn.hidden=true}else guide()};
})();
