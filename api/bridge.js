// bridge.js — Fox Dashboard
const SHEET_ID = '1j_ZANhnTaSVmAMpP2OM2LKo6Wbq0tFP0cTs2Ck0qXNw';

const GID_MAP = {
  1: 1120750679,  // Janeiro
  2: 789516197,   // Fevereiro
  3: 1736046432,  // Março
  4: 763503663,   // Abril
  5: 923945500,   // Maio
  6: 926032448,   // Junho
};

const NOMES = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'};

function parseNum(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? 0 : Math.abs(n);
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

function processMes(rows, diaHoje, mesAtual, targetMes) {
  // Colunas: A=DATA(0) B=TRÁFEGO(1) C=SAÍDA(2) D=DESPESAS(3) E=FAT(4) F=19,90qtd(5) G=24,90qtd(6) H=10qtd(7) I=60qtd(8) J=65qtd(9) K=70+qtd(10) L=LUCRO(11)
  const result = {
    fat: 0, sinais: 0, aprovados: 0,
    sinal_10: 0, sinal_19: 0, sinal_24: 0, aprov_60: 0, aprov_69: 0, aprov_75: 0,
    trafego: 0, saida: 0, despesas: 0, lucro: 0,
    porDia: {}, count: 0,
    hoje: { sinal_10:0, sinal_19:0, sinal_24:0, aprov_60:0, aprov_69:0, aprov_75:0, total:0, count:0, sinais:0, aprovados:0 }
  };

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;
    const diaCell = String(row[0] || '');
    const diaMatch = diaCell.match(/(\d+)/);
    if (!diaMatch) continue;
    const dia = parseInt(diaMatch[1]);
    if (dia < 1 || dia > 31) continue;

    const fat  = parseNum(row[4]);
    const q10  = parseNum(row[7]);
    const q19  = parseNum(row[5]);
    const q24  = parseNum(row[6]);
    const q60  = parseNum(row[8]);
    const q65  = parseNum(row[9]);
    const q70  = parseNum(row[10]);
    const traf = parseNum(row[1]);
    const saida= parseNum(row[2]);
    const desp = parseNum(row[3]);

    const v10 = q10 * 10.00;
    const v19 = q19 * 19.90, v24 = q24 * 24.90;
    const v60 = q60 * 60.00, v65 = q65 * 69.90, v70 = q70 * 75.00;
    const vCalc = v10+v19+v24+v60+v65+v70;
    const totalDia = fat > 0 ? fat : vCalc;

    if (totalDia === 0 && traf === 0 && saida === 0 && desp === 0) continue;

    result.fat      += totalDia;
    result.sinal_10 += v10; result.sinal_19 += v19; result.sinal_24 += v24;
    result.aprov_60 += v60; result.aprov_69 += v65; result.aprov_75 += v70;
    result.trafego  += traf; result.saida += saida; result.despesas += desp;
    if (totalDia > 0) result.count++;

    result.porDia[dia] = {
      sinal_10:v10, sinal_19:v19, sinal_24:v24, aprov_60:v60, aprov_69:v65, aprov_75:v70,
      total:totalDia, trafego:traf, saida:saida, despesas:desp
    };

    if (targetMes === mesAtual && dia === diaHoje) {
      result.hoje.sinal_10 += v10; result.hoje.sinal_19 += v19; result.hoje.sinal_24 += v24;
      result.hoje.aprov_60 += v60; result.hoje.aprov_69 += v65; result.hoje.aprov_75 += v70;
      result.hoje.total += totalDia;
      result.hoje.count = Math.round(q10+q19+q24+q60+q65+q70);
    }
  }

  result.sinais    = result.sinal_10 + result.sinal_19 + result.sinal_24;
  result.aprovados = result.aprov_60 + result.aprov_69 + result.aprov_75;
  result.lucro     = result.fat - result.trafego - result.saida;
  result.hoje.sinais    = result.hoje.sinal_10 + result.hoje.sinal_19 + result.hoje.sinal_24;
  result.hoje.aprovados = result.hoje.aprov_60 + result.hoje.aprov_69 + result.hoje.aprov_75;
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return res.status(200).json({ ok: true });

  try {
    const br = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const mesAtual = br.getMonth() + 1;
    const diaHoje  = br.getDate();

    const meses = Object.keys(GID_MAP).map(Number);
    const csvs  = await Promise.all(meses.map(m => getCSV(GID_MAP[m]).catch(() => null)));

    const historico = {};
    let mesData = null;

    for (let idx = 0; idx < meses.length; idx++) {
      const m = meses[idx];
      if (!csvs[idx]) continue;
      const rows = parseCSV(csvs[idx]);
      const data = processMes(rows, diaHoje, mesAtual, m);
      historico[m] = { nome: NOMES[m], ...data };
      if (m === mesAtual) mesData = data;
    }

    if (!mesData) throw new Error('Dados do mês atual não encontrados');

    const resp = {
      hoje: mesData.hoje,
      mes: {
        sinal_10: mesData.sinal_10, sinal_19: mesData.sinal_19, sinal_24: mesData.sinal_24,
        aprov_60: mesData.aprov_60, aprov_69: mesData.aprov_69, aprov_75: mesData.aprov_75,
        total: mesData.fat, sinais: mesData.sinais, aprovados: mesData.aprovados,
        trafego: mesData.trafego, saida: mesData.saida, despesas: mesData.despesas, lucro: mesData.lucro,
        count: mesData.count
      },
      porDia: mesData.porDia,
      diasComFat: mesData.count,
      mediaDiaria: mesData.count > 0 ? mesData.fat / mesData.count : 0,
      meta: 700,
      diaAtual: diaHoje,
      timestamp: new Date().toISOString(),
      ultimosPix: [],
      historico: historico,
      lucroTotal: mesData.lucro,
      lucroPett: mesData.lucro * 0.5,
      lucroFranca: mesData.lucro * 0.5,
    };

    res.status(200).json(resp);
  } catch(e) {
    console.error('bridge error:', e.message);
    res.status(500).json({ error: e.message });
  }
};
