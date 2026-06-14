const CS_BASE = 'https://api.contasimples.com';
let tok = { v: null, exp: 0 };

async function token() {
  if (tok.v && Date.now() < tok.exp) return tok.v;
  const r = await fetch(CS_BASE + '/oauth/v1/access-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.CS_API_KEY, client_secret: process.env.CS_API_SECRET })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('token falhou: ' + JSON.stringify(d));
  tok = { v: d.access_token, exp: Date.now() + 3400000 };
  return tok.v;
}

function cat(v) {
  const a = Math.abs(v);
  if (Math.abs(a - 19.9) < 0.5) return 'sinal_19';
  if (Math.abs(a - 24.9) < 0.5) return 'sinal_24';
  if (Math.abs(a - 60) < 2) return 'aprov_60';
  if (Math.abs(a - 65) < 2) return 'aprov_65';
  if (a >= 70 && a <= 300) return 'aprov_70';
  return null;
}

async function txns(t) {
  const hoje = new Date();
  const y = hoje.getFullYear(), m = String(hoje.getMonth()+1).padStart(2,'0');
  const s = y+'-'+m+'-01', e = hoje.toISOString().split('T')[0];
  let all = [], nxt = null;
  do {
    let url = CS_BASE+'/statements/v1/banking?startDate='+s+'&endDate='+e+'&limit=50&sorting=transactionDate:ASC';
    if (nxt) url += '&nextPageStartKey=' + encodeURIComponent(nxt);
    const r = await fetch(url, { headers: { Authorization: 'Bearer '+t } });
    const d = await r.json();
    all = all.concat((d.transactions||[]).filter(x => {
      const v = Math.abs(x.brlAmount);
      const tp = (x.transactionType&&x.transactionType.subType||'').toLowerCase();
      const ds = (x.description||'').toLowerCase();
      return (tp.includes('pix')||ds.includes('pix')) && x.brlAmount>0 && v>=19 && v<=300;
    }));
    nxt = d.nextPageStartKey || null;
  } while (nxt);
  return all;
}

function calc(all) {
  const hoje = new Date(), dh = hoje.getDate(), hs = hoje.toISOString().split('T')[0];
  const m = { hoje:{sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0,count:0}, mes:{sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0,count:0}, porDia:{}, ultimosPix:[] };
  all.forEach(x => {
    const v = Math.abs(x.brlAmount), c = cat(x.brlAmount); if (!c) return;
    const ds = x.transactionDate.split('T')[0], dia = parseInt(ds.split('-')[2]);
    m.mes[c]+=v; m.mes.total+=v; m.mes.count++;
    if (ds===hs) { m.hoje[c]+=v; m.hoje.total+=v; m.hoje.count++; }
    if (!m.porDia[dia]) m.porDia[dia]={sinal_19:0,sinal_24:0,aprov_60:0,aprov_65:0,aprov_70:0,total:0};
    m.porDia[dia][c]+=v; m.porDia[dia].total+=v;
    if (m.ultimosPix.length<15) m.ultimosPix.unshift({valor:v,categoria:c,horario:x.transactionDate,descricao:x.sourceDestinationName||x.description||'PIX'});
  });
  m.ultimosPix.sort((a,b)=>new Date(b.horario)-new Date(a.horario));
  m.hoje.sinais=m.hoje.sinal_19+m.hoje.sinal_24; m.hoje.aprovados=m.hoje.aprov_60+m.hoje.aprov_65+m.hoje.aprov_70;
  m.mes.sinais=m.mes.sinal_19+m.mes.sinal_24; m.mes.aprovados=m.mes.aprov_60+m.mes.aprov_65+m.mes.aprov_70;
  m.diasComFat=Object.keys(m.porDia).length;
  m.mediaDiaria=m.diasComFat>0?m.mes.total/m.diasComFat:0;
  m.meta=700; m.diaAtual=dh; m.timestamp=new Date().toISOString();
  return m;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method==='POST') return res.status(200).json({ok:true});
  try {
    const t = await token();
    const all = await txns(t);
    res.status(200).json(calc(all));
  } catch(e) {
    res.status(500).json({error: e.message});
  }
};
