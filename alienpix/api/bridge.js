// bridge.js — mesmo contrato do Apps Script antigo:
//   GET /api/bridge?aba=AGOSTO&range=A3:L35 -> { data: [[...]] }
const SHEET_ID='1aPgEdIQbPaCOUIieQ3Yb9IS4mMlBKFlXNmtEdBWJISs';
const GID_MAP={JANEIRO:1930056113,FEVEREIRO:139141619,MARCO:394024566,ABRIL:1775302632,MAIO:1874931146,JUNHO:1904737424,JULHO:1460532624,AGOSTO:1775966737};
const MESES=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
function normalizar(s){return String(s||'').trim().toUpperCase().replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I').replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ç/g,'C');}
function mesAtualBR(){const s=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',month:'numeric'}).format(new Date());return MESES[Number(s)-1];}
function parseRange(r){const m=String(r||'').toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);if(!m)return null;const col=l=>{let n=0;for(const c of l)n=n*26+(c.charCodeAt(0)-64);return n;};return{c1:col(m[1]),r1:Number(m[2]),c2:col(m[3]),r2:Number(m[4])};}
function parseCSV(t){const rows=[];let cur='',row=[],q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else if(c==='"')q=true;else if(c===',') {row.push(cur);cur='';}else if(c==='\n'){row.push(cur);rows.push(row);row=[];cur='';}else if(c!=='\r')cur+=c;}if(cur!==''||row.length){row.push(cur);rows.push(row);}return rows;}
function pareceCSV(t){if(!t)return false;const h=t.slice(0,200);if(/^\s*[<{]/.test(h))return false;if(/google\.visualization|invalid_query|Bad Request/i.test(h))return false;return true;}
async function baixar(u){try{const r=await fetch(u);if(!r.ok)return null;const t=await r.text();return pareceCSV(t)?t:null;}catch(e){return null;}}
async function csvDaAba(nome){const k=normalizar(nome);if(GID_MAP[k]){const c=await baixar('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/export?format=csv&gid='+GID_MAP[k]);if(c)return c;}if(MESES.indexOf(k)===-1)return null;const vars=k==='MARCO'?['MARÇO','MARCO']:[nome,k];for(const v of vars){const c=await baixar('https://docs.google.com/spreadsheets/d/'+SHEET_ID+'/gviz/tq?tqx=out:csv&headers=0&sheet='+encodeURIComponent(v));if(c)return c;}return null;}
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');
  try{
    const url=new URL(req.url,'http://x');
    const aba=url.searchParams.get('aba')||mesAtualBR();
    const range=url.searchParams.get('range')||'A3:L35';
    const r=parseRange(range);
    if(!r)return res.status(200).json({erro:'range invalido: '+range});
    const csv=await csvDaAba(aba);
    if(!csv)return res.status(200).json({erro:'aba nao encontrada: '+aba});
    const linhas=parseCSV(csv);
    const data=[];
    for(let L=r.r1;L<=r.r2;L++){const o=linhas[L-1]||[];const s=[];for(let C=r.c1;C<=r.c2;C++)s.push(o[C-1]===undefined?'':String(o[C-1]));data.push(s);}
    return res.status(200).json({data});
  }catch(e){return res.status(200).json({erro:String(e&&e.message||e)});}
}
