// bridge.js — lê planilha Google Sheets via CSV público
const SHEET_ID = '1j_ZANhnTaSVmAMpP2OM2LKo6Wbq0tFP0cTs2Ck0qXNw';

// GIDs reais das abas (pegar via ?gid= na URL)
const GID_MAP = {
  1: 0,          // Janeiro (gid padrão)
  2: 0,          // Fevereiro
  3: 926032448,  // Março (mesmo gid que Junho na planilha original)
  4: 0,          // ABRIL
  5: 0,          // MAIO
  6: 926032448,  // JUNHO ← confirmado
  7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0
};

function parseNum(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? 0 : n;
}

async function getCSV(gid) {
  const url = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + gid;
  const r = await fetch(url);
  if (!r.ok) throw new Error('CSV error ' + r.status + ' gid=' + gid);
  return r.text();
}

function parseCSV(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const cells = [];
    let cur = '', inQ = false;
    for (const ch of line + ',') {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    rows.push(cells);
  }
  return rows;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return res.status(200).json({ ok: true });

  try {
    const hoje = new Date();
    // Ajusta pra horário de Brasília
    const br = new Date(hoje.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const mesAtual = br.getMonth() + 1;
    const diaHoje = br.getDate();
    const gid = GID_MAP[mesAtual] || 0;

    const csv = await getCSV(gid);
    const rows = parseCSV(csv);

    const m = {
      hoje: { sinal_19:0, sinal_24:0, aprov_60:0, aprov_65:0, aprov_70:0, total:0, count:0 },
      mes:  { sinal_19:0, sinal_24:0, aprov_60:0, aprov_65:0, aprov_70:0, total:0, count:0 },
      porDia: {}, ultimosPix: []
    };

    // Pula cabeçalhos (linhas 0,1,2) — dados começam na linha 3
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;

      // Coluna A = DATA
      const diaCell = String(row[0] || '');
      const diaMatch = diaCell.match(/(\d+)/);
      if (!diaMatch) continue;
      const dia = parseInt(diaMatch[1]);
      if (dia < 1 || dia > 31) continue;

      // Colunas: E=fat(4) F=19,90qtd(5) G=24,90qtd(6) H=skip(7) I=60qtd(8) J=65qtd(9) K=70+qtd(10)
      const fat = parseNum(row[4]);
      const q19 = parseNum(row[5]);
      const q24 = parseNum(row[6]);
      const q60 = parseNum(row[8]);
      const q65 = parseNum(row[9]);
      const q70 = parseNum(row[10]);

      if (fat === 0 && q19 === 0 && q24 === 0 && q60 === 0 && q65 === 0 && q70 === 0) continue;

      // Valor aproximado por categoria
      const v19 = q19 * 19.90;
      const v24 = q24 * 24.90;
      const v60 = q60 * 60.00;
      const v65 = q65 * 65.00;
      const v70 = q70 * 70.00;
      const totalDia = fat > 0 ? fat : (v19+v24+v60+v65+v70);

      // Mês
      m.mes.sinal_19 += v19; m.mes.sinal_24 += v24;
      m.mes.aprov_60 += v60; m.mes.aprov_65 += v65; m.mes.aprov_70 += v70;
      m.mes.total += totalDia; m.mes.count++;

      // Por dia
      m.porDia[dia] = { sinal_19:v19, sinal_24:v24, aprov_60:v60, aprov_65:v65, aprov_70:v70, total:totalDia };

      // Hoje
      if (dia === diaHoje) {
        m.hoje.sinal_19 += v19; m.hoje.sinal_24 += v24;
        m.hoje.aprov_60 += v60; m.hoje.aprov_65 += v65; m.hoje.aprov_70 += v70;
        m.hoje.total += totalDia;
        m.hoje.count = Math.round(q19+q24+q60+q65+q70);
      }
    }

    m.hoje.sinais    = m.hoje.sinal_19 + m.hoje.sinal_24;
    m.hoje.aprovados = m.hoje.aprov_60 + m.hoje.aprov_65 + m.hoje.aprov_70;
    m.mes.sinais     = m.mes.sinal_19  + m.mes.sinal_24;
    m.mes.aprovados  = m.mes.aprov_60  + m.mes.aprov_65  + m.mes.aprov_70;
    m.diasComFat  = Object.keys(m.porDia).length;
    m.mediaDiaria = m.diasComFat > 0 ? m.mes.total / m.diasComFat : 0;
    m.meta = 700; m.diaAtual = diaHoje;
    m.timestamp = new Date().toISOString();

    res.status(200).json(m);
  } catch(e) {
    console.error('bridge error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
