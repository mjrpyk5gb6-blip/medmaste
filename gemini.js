// ===== Gemini連携（無料APIキー・Claudeを使わずにAI機能を動かす） =====
(function(){
const GK="mm_gem",MODELS=["gemini-flash-latest","gemini-2.5-flash","gemini-2.0-flash"];
const gget=()=>{try{return JSON.parse(localStorage.getItem(GK)||"{}")}catch(e){return{}}};
const gset=o=>{try{localStorage.setItem(GK,JSON.stringify(o))}catch(e){}};
const toB64=async x=>{let b=x;if(typeof x=="string"){if(x.startsWith("data:")){const m=x.match(/^data:([^;]+);base64,(.*)$/);return{mime_type:m[1],data:m[2]}}b=await (await fetch(x)).blob()}
 const d=await new Promise((r,j)=>{const f=new FileReader;f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(b)});const m=d.match(/^data:([^;]+);base64,(.*)$/);return{mime_type:m[1]||"image/jpeg",data:m[2]}};
const toText=c=>typeof c=="string"?c:Array.isArray(c)?c.map(p=>p.text||"").join("\n"):String(c??"");
async function body(input,o,json){const turns=Array.isArray(input)?input:[{role:"user",content:input}];
 const contents=turns.map(t=>({role:t.role=="assistant"?"model":"user",parts:[{text:toText(t.content)}]}));
 if(o.images){const L=Array.isArray(o.images)?o.images:[o.images];const P=contents[contents.length-1].parts;for(const im of L)P.push({inline_data:await toB64(im)})}
 const b={contents};if(json)b.generationConfig={responseMimeType:"application/json"};return b}
function err(code,msg){const e=new Error(msg);e.code=code;return e}
async function call(input,o={},json){const g=gget();if(!g.key)throw err("no_key","GeminiのAPIキーが未設定です");
 const b=JSON.stringify(await body(input,o,json));const list=[g.model||MODELS[0],...MODELS].filter((v,i,a)=>v&&a.indexOf(v)==i);let last;
 for(const m of list){const stream=!!o.onText&&!json;const url=`https://generativelanguage.googleapis.com/v1beta/models/${m}:${stream?"streamGenerateContent?alt=sse":"generateContent"}`;
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":g.key},body:b});
  if(r.status==404||r.status>=500){last=err("model",r.status==404?"モデルが見つかりません："+m:"Geminiが混雑中です。少し時間をおいてください");continue}
  if(r.status==429)throw err("limit","Geminiの無料枠の上限です。少し時間をおいてください");
  if(r.status==400||r.status==403){const t=await r.text();throw err("key",/API key|API_KEY/i.test(t)?"APIキーが正しくありません":"Geminiエラー："+t.slice(0,120))}
  if(!r.ok)throw err("http","Geminiエラー（"+r.status+"）");
  if(g.model!=m){g.model=m;gset(g)}
  if(!stream){const j=await r.json();return{text:(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("")}}
  const rd=r.body.getReader(),dec=new TextDecoder;let buf="",text="";
  for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf("\n"))>=0){const ln=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!ln.startsWith("data:"))continue;try{const j=JSON.parse(ln.slice(5));text+=(j.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("");o.onText({text})}catch(e){}}}
  return{text}}
 throw last}
function parse(t){t=String(t).replace(/^```(?:json)?\s*|\s*```$/g,"").trim();try{return JSON.parse(t)}catch(e){}const m=t.match(/[\[{][\s\S]*[\]}]/);if(m)return JSON.parse(m[0]);throw err("json","生成結果を読めませんでした")}
const GEM=(input,o)=>call(input,o||{},false);GEM.json=async(input,o)=>parse((await call(input,o||{},true)).text);GEM.limits=async()=>({images:true});GEM.isGemini=true;
let CL=null; // Claude版のAI（あれば）
function apply(){try{if(AI&&!AI.isGemini)CL=AI;const g=gget(),want=g.key&&g.use!="off"&&(g.use=="always"||!CL);const before=AI;AI=want?GEM:CL;if(before!==AI&&typeof view!="undefined"&&view.name=="home"&&typeof home=="function")home()}catch(e){}}
window.gemApply=apply;apply();[800,2000,4000,8000].forEach(t=>setTimeout(apply,t));

// --- 設定画面にカードを追加 ---
const _set=set;set=function(){_set.apply(this,arguments);const g=gget();const c=document.createElement("details");c.className="card";c.innerHTML=`<summary style="font-weight:800;font-size:16px;cursor:pointer;padding:10px 0">🤖 無料AI（Gemini）${g.key?"：設定済み":"：未設定"}</summary>
<div class="sub" style="margin:6px 0">Google Geminiの無料APIキーを入れると、GitHub版でもAI機能（カード作成・解説・問題の修正など）が使えます。Claudeの使用量は減りません。キーはこの端末にだけ保存されます。</div>
<div class="sub" style="margin:8px 0 2px">APIキー（aistudio.google.com で無料取得）</div><input id="gmK" type="password" autocomplete="off" value="${esc(g.key||"")}" placeholder="AIza...">
<div class="sub" style="margin:8px 0 2px">使い方</div><select id="gmU"><option value="auto" ${g.use!="always"&&g.use!="off"?"selected":""}>Claudeが使えない時だけGemini（GitHub版はこれでOK）</option><option value="always" ${g.use=="always"?"selected":""}>いつもGemini（Claudeの使用量を節約）</option><option value="off" ${g.use=="off"?"selected":""}>使わない</option></select>
<div class="sub" style="margin:8px 0 2px">モデル（ふつうは空欄のままでOK）</div><input id="gmM" value="${esc(g.model||"")}" placeholder="${MODELS[0]}">
<div class="row" style="gap:6px;margin-top:10px"><button class="p grow" onclick="gemSave()">保存</button><button class="grow" onclick="gemTest()">接続テスト</button></div><div id="gmR" class="sub" style="margin-top:6px"></div>
<div class="sub" style="margin-top:6px">⚠ 無料枠では送った内容がGoogleの改善に使われることがあります。患者さんの情報などは入れないでください。</div>`;app.insertBefore(c,app.children[1]||null)};
window.gemSave=function(){const g=gget();g.key=$("gmK").value.trim();g.use=$("gmU").value;const m=$("gmM").value.trim();if(m)g.model=m;else delete g.model;gset(g);apply();toast("保存しました")};
window.gemTest=async function(){gemSave();const r=$("gmR");r.textContent="テスト中…";try{const x=await GEM("「OK」とだけ返して");r.textContent="✅ 使えます（"+(gget().model||MODELS[0])+"）："+x.text.trim().slice(0,20)}catch(e){r.textContent="❌ "+e.message}};

// --- 「直す」画面にAI点検ボタン ---
const _fix=fixOpen;fixOpen=function(){_fix.apply(this,arguments);const o=$("fxO");if(!o||!AI)return;const h=o.querySelector(".sub");if(!h)return;const d=document.createElement("div");d.innerHTML=`<button class="s" id="fxAI" onclick="fixAI()">🤖 AIに点検・修正案を出してもらう</button><div id="fxAIr" class="sub" style="margin:6px 0"></div>`;h.after(d)};
window.fixAI=async function(){const c=S.cur,mc=c.type=="mcq",r=$("fxAIr"),b=$("fxAI");if(!c||!AI)return;b.disabled=true;r.textContent="🤖 点検中…";
 try{const x=await AI.json(`${AIRULE}\n次の試験対策カードを点検し、医学的な誤り・答えのズレ・文字起こしの聞き間違い/変換ミス・不自然な日本語を直す。正しければ変えない。\n問題：${$("fxQ").value}\n${mc?"選択肢："+c.opts.map((o,i)=>i+":"+o).join(" / ")+"\n現在の正解番号："+$("fxA").value:"答え："+$("fxA").value}\n解説：${$("fxE").value}\nJSONのみ出力：{"ok":true/false,"q":"直した問題文","a":${mc?"正解の番号(数値)":"\"直した答え\""},"exp":"直した解説","why":"何を直したか（短く）"}`);
  if(x.q)$("fxQ").value=x.q;if(x.a!=null&&x.a!=="")$("fxA").value=x.a;if(x.exp!=null)$("fxE").value=x.exp;r.innerHTML=(x.ok?"✅ 問題なさそうです。":"✏ 修正案を入れました（確認して「保存」）：")+esc(x.why||"")}catch(e){r.textContent="AIを使えませんでした（"+(e.message||"")+"）"}b.disabled=false};
})();
