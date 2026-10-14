// ===== 無料AI連携（Gemini → Groq → OpenRouter の順に自動切替・Claudeを使わずにAI機能を動かす） =====
(function(){
const GK="mm_gem",MODELS=["gemini-flash-latest","gemini-2.5-flash","gemini-2.0-flash"];
const gget=()=>{try{return JSON.parse(localStorage.getItem(GK)||"{}")}catch(e){return{}}};
const gset=o=>{try{localStorage.setItem(GK,JSON.stringify(o))}catch(e){}};
const toB64=async x=>{let b=x;if(typeof x=="string"){if(x.startsWith("data:")){const m=x.match(/^data:([^;]+);base64,(.*)$/);return{mime_type:m[1],data:m[2]}}b=await (await fetch(x)).blob()}
 const d=await new Promise((r,j)=>{const f=new FileReader;f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(b)});const m=d.match(/^data:([^;]+);base64,(.*)$/);return{mime_type:m[1]||"image/jpeg",data:m[2]}};
const toText=c=>typeof c=="string"?c:Array.isArray(c)?c.map(p=>p.text||"").join("\n"):String(c??"");
const turnsOf=input=>Array.isArray(input)?input:[{role:"user",content:input}];
const imgsOf=o=>o.images?(Array.isArray(o.images)?o.images:[o.images]):[];
function err(code,msg){const e=new Error(msg);e.code=code;return e}
const soft=s=>s==404||s==408||s==429||s>=500; // 次のAI/モデルへ回すエラー

// ---- Gemini ----
async function gemini(input,o,json,g){
 const contents=turnsOf(input).map(t=>({role:t.role=="assistant"?"model":"user",parts:[{text:toText(t.content)}]}));
 const P=contents[contents.length-1].parts;for(const im of imgsOf(o))P.push({inline_data:await toB64(im)});
 const b={contents};if(json)b.generationConfig={responseMimeType:"application/json"};const body=JSON.stringify(b);
 const list=[g.model||MODELS[0],...MODELS].filter((v,i,a)=>v&&a.indexOf(v)==i);let last;
 for(const m of list){const stream=!!o.onText&&!json;const url=`https://generativelanguage.googleapis.com/v1beta/models/${m}:${stream?"streamGenerateContent?alt=sse":"generateContent"}`;
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":g.key},body});
  if(r.status==404||r.status>=500){last=err("busy",r.status==404?"モデルなし："+m:"混雑中（"+r.status+"）");continue}
  if(r.status==429)throw err("busy","無料枠の上限");
  if(r.status==400||r.status==403){const t=await r.text();throw err("key",/API key|API_KEY/i.test(t)?"APIキーが正しくありません":"エラー："+t.slice(0,100))}
  if(!r.ok)throw err("busy","エラー（"+r.status+"）");
  if(g.model!=m){g.model=m;gset(g)}
  if(!stream){const j=await r.json();return{text:(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("")}}
  const rd=r.body.getReader(),dec=new TextDecoder;let buf="",text="";
  for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf("\n"))>=0){const ln=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!ln.startsWith("data:"))continue;try{const j=JSON.parse(ln.slice(5));text+=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("");o.onText({text})}catch(e){}}}
  return{text}}
 throw last}

// ---- OpenAI互換（Groq・OpenRouter）----
const OAI={
 groq:{name:"Groq",base:"https://api.groq.com/openai/v1",
  text:[/llama-3\.3-70b/,/gpt-oss-120b/,/qwen/,/llama-4-maverick/,/llama/],img:[/llama-4-scout/,/llama-4-maverick/,/vision/],
  async models(key){const r=await fetch(this.base+"/models",{headers:{Authorization:"Bearer "+key}});if(!r.ok)throw r;return(await r.json()).data.map(m=>({id:m.id,img:/vision|scout|maverick/.test(m.id)}))}},
 or:{name:"OpenRouter",base:"https://openrouter.ai/api/v1",
  text:[/gemini.*:free/,/deepseek.*:free/,/llama-3\.3-70b.*:free/,/qwen.*:free/,/:free$/],img:[/gemini.*:free/,/llama-4.*:free/,/qwen.*vl.*:free/,/:free$/],
  async models(){const r=await fetch(this.base+"/models");if(!r.ok)throw r;return(await r.json()).data.filter(m=>/:free$/.test(m.id)).map(m=>({id:m.id,img:(m.architecture?.input_modalities||[]).includes("image")}))}}};
const mcache={};
async function pick(p,key,img){const P=OAI[p];let L=mcache[p];
 if(!L){try{L=mcache[p]=await P.models(key)}catch(e){L=[]}}
 if(img)L=L.filter(m=>m.img);const ids=L.map(m=>m.id),out=[];
 for(const re of img?P.img:P.text)for(const id of ids)if(re.test(id)&&!out.includes(id))out.push(id);
 return out.slice(0,3)}
async function oai(p,input,o,json,key){const P=OAI[p],ims=imgsOf(o);
 const msgs=turnsOf(input).map(t=>({role:t.role=="assistant"?"assistant":"user",content:toText(t.content)}));
 if(json)msgs.unshift({role:"system",content:"出力はJSONのみ。説明文やコードブロックは付けない。"});
 if(ims.length){const last=msgs[msgs.length-1];const parts=[{type:"text",text:last.content}];for(const im of ims){const b=await toB64(im);parts.push({type:"image_url",image_url:{url:`data:${b.mime_type};base64,${b.data}`}})}last.content=parts}
 const models=await pick(p,key,ims.length>0);if(!models.length)throw err("busy",ims.length?"画像に使えるモデルなし":"使えるモデルなし");
 const H={"Content-Type":"application/json"};if(key)H.Authorization="Bearer "+key;if(p=="or"){H["X-Title"]="MedMaster"}
 let last;
 for(const m of models){const r=await fetch(P.base+"/chat/completions",{method:"POST",headers:H,body:JSON.stringify({model:m,messages:msgs,temperature:0.3})});
  if(soft(r.status)){last=err("busy","混雑中（"+r.status+"）");continue}
  if(r.status==401||r.status==403)throw err("key","APIキーが正しくありません");
  if(!r.ok){last=err("busy","エラー（"+r.status+"）");continue}
  const j=await r.json();const text=j.choices?.[0]?.message?.content||"";if(!text){last=err("busy","空の返事");continue}
  if(o.onText)try{o.onText({text})}catch(e){}
  return{text}}
 throw last}

// ---- 順番に試す ----
async function call(input,o={},json){const g=gget();
 const order=[g.key&&["Gemini",()=>gemini(input,o,json,g)],g.groq&&["Groq",()=>oai("groq",input,o,json,g.groq)],g.or&&["OpenRouter",()=>oai("or",input,o,json,g.or)]].filter(Boolean);
 if(!order.length)throw err("no_key","無料AIのAPIキーが未設定です（設定画面）");
 const fails=[];
 for(const[n,f]of order){try{const r=await f();GEM.last=n;return r}catch(e){fails.push(n+"："+(e.message||"接続できません"))}}
 throw err("all","どのAIも使えませんでした（"+fails.join(" / ")+"）。少し時間をおいてください")}
function parse(t){t=String(t).replace(/^```(?:json)?\s*|\s*```$/g,"").trim();try{return JSON.parse(t)}catch(e){}const m=t.match(/[\[{][\s\S]*[\]}]/);if(m)return JSON.parse(m[0]);throw err("json","生成結果を読めませんでした")}
const GEM=(input,o)=>call(input,o||{},false);GEM.json=async(input,o)=>parse((await call(input,o||{},true)).text);GEM.limits=async()=>({images:true});GEM.isGemini=true;
let CL=null; // Claude版のAI（あれば）
const hasKey=g=>!!(g.key||g.groq||g.or);
function apply(){try{if(AI&&!AI.isGemini)CL=AI;const g=gget(),want=hasKey(g)&&g.use!="off"&&(g.use=="always"||!CL);const before=AI;AI=want?GEM:CL;if(before!==AI&&typeof view!="undefined"&&view.name=="home"&&typeof home=="function")home()}catch(e){}}
window.gemApply=apply;apply();[800,2000,4000,8000].forEach(t=>setTimeout(apply,t));

// --- 設定画面にカードを追加 ---
const kf=(id,label,url,v,ph)=>`<div class="sub" style="margin:8px 0 2px">${label}（<a href="${url}" target="_blank">${url.replace("https://","")}</a> で無料取得）</div><input id="${id}" type="password" autocomplete="off" value="${esc(v||"")}" placeholder="${ph}">`;
const _set=set;set=function(){_set.apply(this,arguments);const g=gget();const n=[g.key,g.groq,g.or].filter(Boolean).length;const c=document.createElement("details");c.className="card";c.innerHTML=`<summary style="font-weight:800;font-size:16px;cursor:pointer;padding:10px 0">🤖 無料AI：${n?n+"個 設定済み":"未設定"}</summary>
<div class="sub" style="margin:6px 0">無料APIキーを入れると、Claudeを使わずにAI機能（カード作成・解説・問題の修正など）が動きます。<b>Gemini → Groq → OpenRouter</b> の順に試し、混んでいたら自動で次へ切り替えます。1つだけでも使えます。キーはこの端末にだけ保存されます。カード（お支払い情報）は登録しないでください。</div>
${kf("gmK","① Gemini（メイン）","https://aistudio.google.com",g.key,"Geminiのキー")}
${kf("gmG","② Groq（予備）","https://console.groq.com/keys",g.groq,"gsk_...")}
${kf("gmO","③ OpenRouter（予備）","https://openrouter.ai/keys",g.or,"sk-or-...")}
<div class="sub" style="margin:8px 0 2px">使い方</div><select id="gmU"><option value="auto" ${g.use!="always"&&g.use!="off"?"selected":""}>Claudeが使えない時だけ（GitHub版はこれでOK）</option><option value="always" ${g.use=="always"?"selected":""}>いつも無料AI（Claudeの使用量を節約）</option><option value="off" ${g.use=="off"?"selected":""}>使わない</option></select>
<div class="sub" style="margin:8px 0 2px">Geminiのモデル（ふつうは空欄のままでOK）</div><input id="gmM" value="${esc(g.model||"")}" placeholder="${MODELS[0]}">
<div class="row" style="gap:6px;margin-top:10px"><button class="p grow" onclick="gemSave()">保存</button><button class="grow" onclick="gemTest()">接続テスト</button></div><div id="gmR" class="sub" style="margin-top:6px;white-space:pre-line"></div>
<div class="sub" style="margin-top:6px">⚠ 無料枠では送った内容が各社のAI改善に使われることがあります。患者さんの情報などは入れないでください。</div>`;app.insertBefore(c,app.children[1]||null)};
window.gemSave=function(){const g=gget();g.key=$("gmK").value.trim();g.groq=$("gmG").value.trim();g.or=$("gmO").value.trim();g.use=$("gmU").value;const m=$("gmM").value.trim();if(m)g.model=m;else delete g.model;gset(g);apply();toast("保存しました")};
window.gemTest=async function(){gemSave();const g=gget(),r=$("gmR");if(!hasKey(g)){r.textContent="❌ キーが1つも入っていません";return}r.textContent="テスト中…";const q="「OK」とだけ返して",L=[];
 const T=[["Gemini",g.key,()=>gemini(q,{},false,g)],["Groq",g.groq,()=>oai("groq",q,{},false,g.groq)],["OpenRouter",g.or,()=>oai("or",q,{},false,g.or)]];
 for(const[n,k,f]of T){if(!k)continue;try{const x=await f();L.push("✅ "+n+"：使えます（"+x.text.trim().slice(0,10)+"）")}catch(e){L.push("❌ "+n+"："+(e.message||"接続できません"))}r.textContent=L.join("\n")+"\nテスト中…"}
 r.textContent=L.join("\n")+(L.some(s=>s[0]=="✅")?"\n→ AI機能が使えます":"")};

// --- 「直す」画面にAI点検ボタン ---
const _fix=fixOpen;fixOpen=function(){_fix.apply(this,arguments);const o=$("fxO");if(!o||!AI)return;const h=o.querySelector(".sub");if(!h)return;const d=document.createElement("div");d.innerHTML=`<button class="s" id="fxAI" onclick="fixAI()">🤖 AIに点検・修正案を出してもらう</button><div id="fxAIr" class="sub" style="margin:6px 0"></div>`;h.after(d)};
window.fixAI=async function(){const c=S.cur,mc=c.type=="mcq",r=$("fxAIr"),b=$("fxAI");if(!c||!AI)return;b.disabled=true;r.textContent="🤖 点検中…";
 try{const x=await AI.json(`${AIRULE}\n次の試験対策カードを点検し、医学的な誤り・答えのズレ・文字起こしの聞き間違い/変換ミス・不自然な日本語を直す。正しければ変えない。\n問題：${$("fxQ").value}\n${mc?"選択肢："+c.opts.map((o,i)=>i+":"+o).join(" / ")+"\n現在の正解番号："+$("fxA").value:"答え："+$("fxA").value}\n解説：${$("fxE").value}\nJSONのみ出力：{"ok":true/false,"q":"直した問題文","a":${mc?"正解の番号(数値)":"\"直した答え\""},"exp":"直した解説","why":"何を直したか（短く）"}`);
  if(x.q)$("fxQ").value=x.q;if(x.a!=null&&x.a!=="")$("fxA").value=x.a;if(x.exp!=null)$("fxE").value=x.exp;r.innerHTML=(x.ok?"✅ 問題なさそうです。":"✏ 修正案を入れました（確認して「保存」）：")+esc(x.why||"")+(GEM.last&&AI===GEM?`<span style="opacity:.6">（${GEM.last}）</span>`:"")}catch(e){r.textContent="AIを使えませんでした（"+(e.message||"")+"）"}b.disabled=false};

// --- GitHub版の「📥 資料を送る」：無料AIでその場で問題を作る ---
const IA={busy:false};
const KIND={tr:"授業の文字起こし",re:"レジメ・講義資料",ka:"過去問",ot:"その他の資料"};
function chunks(t,n=9000){const out=[];t=t.replace(/\r/g,"").trim();while(t.length>n){let k=t.lastIndexOf("\n",n);if(k<n*.6)k=t.lastIndexOf("。",n)+1;if(k<n*.6)k=n;out.push(t.slice(0,k));t=t.slice(k).trim()}if(t)out.push(t);return out}
async function fileToParts(f,d){const ext=f.name.split(".").pop().toLowerCase(),R={text:"",imgs:[]};
 if(f.type.startsWith("image/")){const u=await rfile(f,"readAsDataURL");R.imgs.push(await shrink(u));await addFig(d,u)}
 else if(/^(txt|md|csv|vtt|srt)$/.test(ext))R.text=await rfile(f,"readAsText");
 else if(ext=="pdf"){await loadPdfjs();const pdf=await pdfjsLib.getDocument({data:await rfile(f,"readAsArrayBuffer")}).promise;
  for(let i=1;i<=pdf.numPages;i++){const pg=await pdf.getPage(i);const tc=await pg.getTextContent();const t=tc.items.map(x=>x.str).join(" ").trim();
   const vp=pg.getViewport({scale:1.5}),c=document.createElement("canvas");c.width=vp.width;c.height=vp.height;await pg.render({canvasContext:c.getContext("2d"),viewport:vp}).promise;const u=c.toDataURL("image/jpeg",.72);await addFig(d,u);
   if(t.length>40)R.text+=`\n[p.${i}] ${t}`;else if(R.imgs.length<12)R.imgs.push(u)}}
 else if(ext=="pptx"||ext=="docx"){await loadZip();const z=await JSZip.loadAsync(await rfile(f,"readAsArrayBuffer"));
  if(ext=="pptx"){const sl=Object.keys(z.files).filter(k=>/^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a,b)=>+a.match(/\d+/)[0]-+b.match(/\d+/)[0]);for(const k of sl){const x=await z.file(k).async("string");const t=[...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m=>m[1]).join(" ").trim();if(t)R.text+="\n"+t}}
  else{const x=await z.file("word/document.xml").async("string");R.text=x.split(/<\/w:p>/).map(pp=>[...pp.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m=>m[1]).join("")).filter(t=>t.trim()).join("\n")}}
 else if(ext=="zip"){await loadZip();const z=await JSZip.loadAsync(await rfile(f,"readAsArrayBuffer"));
  for(const k of Object.keys(z.files)){if(z.files[k].dir||/__MACOSX|\/\./.test(k))continue;const b=await z.file(k).async("blob");const nm=k.split("/").pop();const ty=/\.(png|jpe?g)$/i.test(nm)?"image/jpeg":"";const r=await fileToParts(new File([b],nm,{type:ty}),d);R.text+=r.text?`\n### ${nm}\n${r.text}`:"";R.imgs.push(...r.imgs)}}
 R.imgs=R.imgs.slice(0,12);return R}
const _inbox=inbox;inbox=async function(){if(window.claude?.use)return _inbox.apply(this,arguments);
 const subs=[...new Set(subjNames())],cur=csOn()?(subjects().find(x=>x.id==csOn())||{}).name:"";const ok=AI===GEM;
 app.innerHTML=`<div class="top"><button class="s" onclick="go('home')">← ホーム</button></div><h1>📥 資料を送る</h1>
<div class="card"><p class="sub" style="margin:0 0 8px">文字起こし・レジメ・過去問を入れると、<b>無料AIがその場で問題を作ります</b>（Claude不要）。長い資料は自動で分けて全部読みます。</p>
${ok?"":`<p style="color:var(--warn);margin:0 0 8px">⚠ 無料AIのキーが未設定です。設定画面の「🤖 無料AI」でキーを入れてください。</p>`}
<div class="sub" style="margin:4px 0 2px">科目</div><select id="iaS" onchange="$('iaN').style.display=this.value=='+'?'':'none'">${subs.map(n=>`<option ${n==cur?"selected":""}>${esc(n)}</option>`).join("")}<option value="+">＋ 新しい科目</option></select>
<input id="iaN" placeholder="新しい科目名" style="display:${subs.length?"none":""};margin-top:6px">
<div class="sub" style="margin:8px 0 2px">範囲名</div><input id="iaD" placeholder="例：第5回 文字起こし" value="${esc(S.lastDn||"")}">
<div class="row" style="gap:6px;margin-top:8px"><span class="sub" style="margin:0">種類</span><select id="iaK" style="width:auto">${Object.entries(KIND).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select><span class="sub" style="margin:0">重要度</span><select id="iaI" style="width:auto"><option>S</option><option selected>A</option><option>B</option><option>C</option></select></div>
<div class="sub" style="margin:8px 0 2px">文章を貼る（文字起こしなど）</div><textarea id="iaT" rows="6" placeholder="ここに貼り付け"></textarea>
<div class="sub" style="margin:8px 0 2px">ファイル（PDF・写真・PowerPoint・Word・テキスト・ZIP、複数可）</div><input id="iaF" type="file" multiple accept=".pdf,.pptx,.docx,.txt,.md,.zip,image/*">
<button class="big p" style="margin-top:10px" onclick="iaRun()" ${ok?"":"disabled"}>🤖 AIで問題を作る</button><div id="iaR" class="sub" style="margin-top:6px;white-space:pre-line"></div></div>`};
window.iaRun=async function(){if(IA.busy)return;const r=$("iaR");let sn=$("iaS").value;if(sn=="+"||!sn)sn=$("iaN").value.trim();const dn=$("iaD").value.trim()||"範囲1",kind=$("iaK").value,imp=$("iaI").value;
 const files=[...$("iaF").files],paste=$("iaT").value.trim();if(!sn)return toast("科目を選んでください");if(!paste&&!files.length)return toast("文章かファイルを入れてください");
 IA.busy=true;S.lastDn=dn;const d=getDeck(sn,dn,imp);let text=paste,imgs=[];
 try{for(const f of files){r.textContent="📄 "+f.name+" を読み込み中…";const x=await fileToParts(f,d);if(x.text)text+=`\n### ${f.name}\n${x.text}`;imgs.push(...x.imgs)}
  if(text.trim())d.text=((d.text||"")+"\n"+text).trim();save();
  const note=kind=="tr"?"これは授業の文字起こしで、聞き間違い・変換ミスを含む。文脈から正しい医学用語に直してカード化し、直したか自信がない箇所は解説に「⚠要確認」と書く。雑談や連絡事項は無視。":kind=="ka"?"これは過去問。問題ごとにカード化し、選択肢があれば type:\"mcq\",opts,ans(0始まりの番号) で出力。正解が資料にない場合は解説に「⚠要確認」。":"";
  const parts=chunks(text),jobs=parts.map(t=>({t}));for(let i=0;i<imgs.length;i+=4)jobs.push({im:imgs.slice(i,i+4)});
  const all=[],fails=[];
  for(let i=0;i<jobs.length;i++){r.textContent=`🤖 問題を作成中… ${i+1}/${jobs.length}`+(fails.length?`（失敗 ${fails.length}）`:"");const j=jobs[i];
   try{const c=await AI.json(`${AIRULE}\n次の${KIND[kind]}${j.im?"（画像）":`（${i+1}/${parts.length}部分）`}から試験対策カードを作成。${note}${CARDJSON}${j.t?"\n---\n"+j.t:""}`,j.im?{images:j.im}:{});if(Array.isArray(c))all.push(...c)}
   catch(e){fails.push(i+1);if(e.code=="all"||e.code=="no_key"){r.textContent="❌ "+e.message;break}}}
  const seen=new Set,uniq=all.filter(c=>{const k=String(c.q||"").replace(/\s/g,"");if(!k||seen.has(k))return false;seen.add(k);return true});
  if(!uniq.length){r.textContent=(r.textContent.startsWith("❌")?r.textContent+"\n":"")+"❌ 問題を作れませんでした。少し時間をおいてもう一度試してください（読み込んだ資料は範囲に保存済み）";IA.busy=false;return}
  IA.busy=false;preview(sn,dn,imp,uniq);if(fails.length)toast(fails.length+"か所は作れませんでした（混雑など）")}
 catch(e){r.textContent="❌ 読み込めませんでした（"+(e.message||e)+"）"}IA.busy=false};
})();
