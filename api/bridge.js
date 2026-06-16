// bridge.js — lê dados da planilha Google Sheets via CSV
// Não depende da ContaSimples API (bloqueada pelo Cloudflare em servidores)

const SHEET_ID = '1j_ZANhnTaSVmAMpP2OM2LKo6Wbq0tFP0cTs2Ck0qXNw';

// GIDs das abas (pegar via URL da planilha)
const ABAS = {
  1:'Janeiro', 2:'Fevereiro', 3:'Março', 4:'ABRIL', 5:'MAIO', 6:'JUNHO',
  7:'Julho', 8:'Agosto', 9:'Setembro', 10:'Outubro', 11:'Novembro', 12:'Dezembro'
};

// Colunas da planilha Fox:
// A=DATA B=TRÁFEGO C=SAÍDA D=DESPESAS E=FATURAMENTO F=19,90 G=24,90 H=29(ignorar) I=60 J=75/65 K=80+/70+
// Índices (0-based): 0=DATA 1=TRAF 2=SAÍDA 3=DESP 4=FAT 5=F19 6=F24 7=- 8=A60 9=A65 10=A70

function parseNum(s) {
  if (!s) return 0;
  return parseFloat(String(s).replace(/[R$\s.]/g,'').replace(',','.')) || 0;
}

async function getSheetCSV(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('Sheet CSV error: ' + r.status);
  return r.text();
}

function parseCSV(text) {
  return text.split('\n').map(line => {
    const cells = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

async function getGID(mesNome) {
  // Busca o GID da aba pelo nome via API pública
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
  // Fallback: usa gid padrão 0 pra primeira aba, tenta outros
  // GIDs conhecidos da planilha Fox (descobertos via URL)
  const gids = {
    'Janeiro': 0, 'Fevereiro': 1, 'Março': 926032448, 'ABRIL': 1,
    'MAIO': 2, 'JUNHO': 926032448
  };
  return gids[mesNome] || 0;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'POST') return res.status(200).json({ ok: true });

  try {
    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const diaHoje = hoje.getDate();
    const mesNome = ABAS[mesAtual];

    const gid = await getGID(mesNome);
    const csv = await getSheetCSV(gid);
    const rows = parseCSV(csv);

    // Inicializa métricas
    const m = {
      hoje: { sinal_19:0, sinal_24:0, aprov_60:0, aprov_65:0, aprov_70:0, total:0, count:0 },
      mes:  { sinal_19:0, sinal_24:0, aprov_60:0, aprov_65:0, aprov_70:0, total:0, count:0 },
      porDia: {}, ultimosPix: []
    };

    // Processa cada linha (pula header — linha 0,1,2 são cabeçalho)
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 5) continue;

      // Extrai dia da coluna A
      const diaCell = String(row[0] || '');
      const diaMatch = diaCell.match(/(\d+)/);
      if (!diaMatch) continue;
      const dia = parseInt(diaMatch[1]);
      if (dia < 1 || dia > 31) continue;

      // Lê valores das colunas
      const fat  = parseNum(row[4]);  // E = FATURAMENTO
      const f19  = parseNum(row[5]);  // F = 19,90 qtd
      const f24  = parseNum(row[6]);  // G = 24,90 qtd
      const a60  = parseNum(row[8]);  // I = 60 qtd
      const a65  = parseNum(row[9]);  // J = 65 qtd
      const a70  = parseNum(row[10]); // K = 70+ qtd

      if (fat === 0 && f19 === 0 && f24 === 0 && a60 === 0) continue;

      // Calcula valores aproximados por categoria (qtd × valor)
      const v19 = f19 * 19.90;
      const v24 = f24 * 24.90;
      const v60 = a60 * 60.00;
      const v65 = a65 * 65.00;
      const v70 = a70 * 70.00;

      // Acumula mês
      m.mes.sinal_19 += v19; m.mes.sinal_24 += v24;
      m.mes.aprov_60 += v60; m.mes.aprov_65 += v65; m.mes.aprov_70 += v70;
      m.mes.total += fat || (v19+v24+v60+v65+v70);
      if (fat > 0 || v19+v24+v60+v65+v70 > 0) m.mes.count++;

      // Acumula por dia
      m.porDia[dia] = { sinal_19:v19, sinal_24:v24, aprov_60:v60, aprov_65:v65, aprov_70:v70, total:fat||v19+v24+v60+v65+v70 };

      // Acumula hoje
      if (dia === diaHoje) {
        m.hoje.sinal_19 += v19; m.hoje.sinal_24 += v24;
        m.hoje.aprov_60 += v60; m.hoje.aprov_65 += v65; m.hoje.aprov_70 += v70;
        m.hoje.total += fat || (v19+v24+v60+v65+v70);
        m.hoje.count += Math.round(f19+f24+a60+a65+a70);
      }
    }

    m.hoje.sinais    = m.hoje.sinal_19 + m.hoje.sinal_24;
    m.hoje.aprovados = m.hoje.aprov_60 + m.hoje.aprov_65 + m.hoje.aprov_70;
    m.mes.sinais     = m.mes.sinal_19  + m.mes.sinal_24;
    m.mes.aprovados  = m.mes.aprov_60  + m.mes.aprov_65  + m.mes.aprov_70;
    m.diasComFat  = Object.keys(m.porDia).length;
    m.mediaDiaria = m.diasComFat > 0 ? m.mes.total / m.diasComFat : 0;
    m.meta = 700;
    m.diaAtual = diaHoje;
    m.timestamp = new Date().toISOString();
    m.ultimosPix = [];

    res.status(200).json(m);
  } catch(e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
};
