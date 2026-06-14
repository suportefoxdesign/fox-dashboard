// api/bridge.js — Fox Dashboard Backend
const CS_API_KEY = process.env.CS_API_KEY;
const CS_API_SECRET = process.env.CS_API_SECRET;
const CS_BASE = 'https://api.contasimples.com';
let tokenCache = { value: null, expires: 0 };
async function getToken() {
  if (tokenCache.value && Date.now() < tokenCache.expires) return tokenCache.value;
  const resp = await fetch(CS_BASE + '/oauth/v1/access-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: CS_API_KEY, client_secret: CS_API_SECRET }) });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Token invalido');
  tokenCache = { value: data.access_token, expires: Date.now() + 3400000 };
  return tokenCache.value;
}
function classificaPIX(valor) {
  const v = Math.abs(valor);
  if (Math.abs(v - 19.90) < 0.50) return 'sinal_19';
  if (Math.abs(v - 24.90) < 0.50) return 'sinal_24';
  if (Math.abs(v - 60.00) < 2.00) return 'aprov_60';
  if (Math.abs(v - 65.00) < 2.00) return 'aprov_65';
  if (v >= 70.00 && v <= 300) return 'aprov_70';
  return null;
}
async function getTransacoesMes(token) {
  const hoje = new Date(); const ano = hoje.getFullYear(); const mes = String(hoje.getMonth()+1).padStart(2,'0');
  const startDate = ano+'-'+mes+'-01'; const endDate = hoje.toISOString().split('T')[0];
  let todas = [], nextKey = null;
  do {
    let url = CS_BASE+'/statements/v1/banking?startDate='+startDate+'&endDate='+endDate+'&limit=50&sorting=transactionDate:ASC';
    if (nextKey) url += '&nextPageStartKey='+encodeURIComponent(nextKey);
    const resp = await fetch(url, { headers: { 'Authorization': 'Bearer '+token } });
    const data = await resp.json();
    const pix = (data.transactions||[]).filter(t => { const val=Math.abs(t.brlAmount); const tipo=(t.transactionType?.subType||'').toLowerCase(); const desc=(t.description||'').toLowerCase(); return (tipo.includes('pix')||desc.includes('pix'))&&t.brlAmount>0&&val>=19&&val<=300; });
    todas=todas.concat(pix); nextKey=data.nextPageStartKey||null;
  } while(nextKey);
  return todas;
}
function processaMetricas(txns) {
  const hoje=new Date(); const diaHoje=hoje.getDate(); const hojeStr=hoje.toISOString().split('T')[0];
  const m={ hoje:{sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0,count:0}, mes:{sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0,count:0}, porDia:{}, ultimosPix:[] };
  txns.forEach(t => {
    const val=Math.abs(t.brlAmount); const cat=classificaPIX(t.brlAmount); if(!cat)return;
    const dataStr=t.transactionDate.split('T')[0]; const dia=parseInt(dataStr.split('-')[2]);
    m.mes[cat]+=val; m.mes.total+=val; m.mes.count++;
    if(dataStr===hojeStr){m.hoje[cat]+=val;m.hoje.total+=val;m.hoje.count++;}
    if(!m.porDia[dia])m.porDia[dia]={sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0};
    m.porDia[dia][cat]+=val; m.porDia[dia].total+=val;
    if(m.ultimosPix.length<15)m.ultimosPix.unshift({valor:val,categoria:cat,horario:t.transactionDate,descricao:t.sourceDestinationName||t.description||'PIX recebido'});
  });
  m.ultimosPix.sort((a,b)=>new Date(b.horario)-new Date(a.horario));
  m.hoje.sinais=m.hoje.sinal_19+m.hoje.sinal_24; m.hoje.aprovados=m.hoje.aprov_60+m.hoje.aprov_65+m.hoje.aprov_70;
  m.mes.sinais=m.mes.sinal_19+m.mes.sinal_24; m.mes.aprovados=m.mes.aprov_60+m.mes.aprov_65+m.mes.aprov_70;
  m.diasComFat=Object.keys(m.porDia).length; m.mediaDiaria=m.diasComFat>0?m.mes.total/m.diasComFat:0;
  m.meta=700; m.progressoMeta=(m.hoje.total/m.meta)*100; m.diaAtual=diaHoje; m.timestamp=new Date().toISOString();
  return m;
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method==='POST')return res.status(200).json({ok:true,received:new Date().toISOString()});
  try { const token=await getToken(); const txns=await getTransacoesMes(token); return res.status(200).json(processaMetricas(txns)); }
  catch(e){ return res.status(500).json({error:e.message}); }
}
