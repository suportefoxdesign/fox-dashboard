// bridge.js — Fox Dashboard
const SHEET_ID = '1j_ZANhnTaSVmAMpP2OM2LKo6Wbq0tFP0cTs2Ck0qXNw';

// Nome da aba de cada mes na planilha (usado via gviz, dispensa gid).
const TAB_NAMES = {
  1:'JANEIRO', 2:'FEVEREIRO', 3:'MARCO', 4:'ABRIL', 5:'MAIO', 6:'JUNHO',
  7:'JULHO', 8:'AGOSTO', 9:'SETEMBRO', 10:'OUTUBRO', 11:'NOVEMBRO', 12:'DEZEMBRO'
};
// Variacoes de grafia tentadas quando o nome acima nao existe.
const TAB_ALIASES = { 3:['MARÇO','Março'], 8:['Agosto'], 9:['Setembro'], 10:['Outubro'], 11:['Novembro'], 12:['Dezembro'] };

// Fallback: gids conhecidos (usado se a busca por nome falhar).
const GID_MAP = {
  1: 1120750679,  // Janeiro
  2: 789516197,   // Fevereiro
  3: 1736046432,  // Março
  4: 763503663,   // Abril
  5: 923945500,   // Maio
  6: 926032448,   // Junho
  7: 1673745313,  // Julho
  9: 359335432,   // Setembro
};

const NOMES = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'};
// Abreviacao usada na coluna DATA da planilha ("1-set.", "12-ago.").
const ABREV = {1:'jan',2:'fev',3:'mar',4:'abr',5:'mai',6:'jun',7:'jul',8:'ago',9:'set',10:'out',11:'nov',12:'dez'};

function parseNum(s) {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[R$\s]/g,'').replace(/\./g,'').replace(',','.'));
  return isNaN(n) ? 0 : Math.abs(n);
}

function normalizar(s) {
  return String(s || '').trim().toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ç/g,'C')
    .replace(/\s+/g,' ');
}

function looksLikeCSV(text) {
  if (!text) return false;
  const head = text.slice(0, 200);
  // gviz devolve JS ("google.visualization...") ou HTML quando a aba nao existe
  if (/^\s*[<{]/.test(head) || /google\.visualization|invalid_query|Bad Request/i.test(head)) return false;
  return text.split('\n').length > 3;
}

async function tryFetch(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const t = await r.text();
    return looksLikeCSV(t) ? t : null;
  } catch (e) { return null; }
}

// Le a coluna DATA e devolve o mes (1-12) que a aba realmente contem.
// "1-set." => 9. Se a aba nao usar abreviacao, devolve null (nao da pra conferir).
function mesDoCSV(csv) {
  const linhas = csv.split('\n').slice(0, 60);
  const contagem = {};
  for (const linha of linhas) {
    const m = linha.match(/(\d{1,2})\s*[-\/ ]\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/i);
    if (!m) continue;
    const abrev = m[2].toLowerCase();
    for (const k in ABREV) if (ABREV[k] === abrev) contagem[k] = (contagem[k] || 0) + 1;
  }
  const achados = Object.keys(contagem).sort((a,b) => contagem[b] - contagem[a]);
  return achados.length ? Number(achados[0]) : null;
}

// Descobre nome -> gid de todas as abas pelo htmlview (publico, sem token).
// Serve para os meses novos: quando a aba de outubro nascer, ela e achada sozinha.
let _abasCache = null;
async function descobrirAbas() {
  if (_abasCache) return _abasCache;
  const mapa = {};
  try {
    const r = await fetch('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/htmlview');
    if (r.ok) {
      const html = await r.text();
      const re = /id="sheet-button-(\d+)"[^>]*>\s*(?:<a[^>]*>)?([^<]+)/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const nome = normalizar(m[2]);
        if (nome) mapa[nome] = m[1];
      }
    }
  } catch (e) { /* sem descoberta, segue nos gids/nomes fixos */ }
  _abasCache = mapa;
  return mapa;
}

function gidPeloNome(mapa, m) {
  const alvo = normalizar(TAB_NAMES[m]);
  const alvoAcento = normalizar(NOMES[m]); // MARCO == MARÇO depois de normalizar
  for (const nome in mapa) {
    if (nome === alvo || nome === alvoAcento) return mapa[nome];
  }
  // aceita "SETEMBRO 2026", "SETEMBRO ", etc.
  for (const nome in mapa) {
    if (nome.startsWith(alvo) || nome.startsWith(alvoAcento)) return mapa[nome];
  }
  return null;
}

// Busca o CSV do mes e SO aceita quando a coluna DATA confirma o mes.
// ATENCAO: quando o nome nao existe, o gviz devolve a PRIMEIRA aba em vez de dar
// erro — foi assim que setembro apareceu zerado (voltava a aba de janeiro).
async function getMesCSV(m) {
  const tentativas = [];

  if (GID_MAP[m]) {
    tentativas.push({
      url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + GID_MAP[m],
      via: 'gid:' + GID_MAP[m]
    });
  }

  const abas = await descobrirAbas();
  const gidDescoberto = gidPeloNome(abas, m);
  if (gidDescoberto && String(gidDescoberto) !== String(GID_MAP[m] || '')) {
    tentativas.push({
      url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + gidDescoberto,
      via: 'aba:' + gidDescoberto
    });
  }

  for (const nome of [TAB_NAMES[m], ...(TAB_ALIASES[m] || [])].filter(Boolean)) {
    tentativas.push({
      url: 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
           '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(nome),
      via: 'nome:' + nome
    });
  }

  let recusado = null;
  for (const t of tentativas) {
    const csv = await tryFetch(t.url);
    if (!csv) continue;
    const mesLido = mesDoCSV(csv);
    if (mesLido !== null && mesLido !== m) { recusado = NOMES[mesLido]; continue; } // veio a aba errada
    return { csv: csv, via: t.via, conferido: mesLido === m };
  }
  return recusado ? { erroMes: recusado } : null;
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
  const isMesCorrente = targetMes === mesAtual;
  const result = {
    fat: 0, sinais: 0, aprovados: 0,
    sinal_10: 0, sinal_19: 0, sinal_24: 0, aprov_60: 0, aprov_69: 0, aprov_75: 0,
    trafego: 0, saida: 0, despesas: 0, lucro: 0,
    porDia: {}, count: 0, diasFuturosIgnorados: 0,
    hoje: { sinal_10:0, sinal_19:0, sinal_24:0, aprov_60:0, aprov_69:0, aprov_75:0, total:0, count:0, sinais:0, aprovados:0 }
  };

  const vistos = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length < 5) continue;
    const diaCell = String(row[0] || '');
    // So linhas de dia ("1-set.", "12-ago."); cabecalho, titulo e totais caem fora.
    const diaMatch = diaCell.match(/^\D*(\d{1,2})\s*[-\/ ]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)?/i);
    if (!diaMatch || !diaMatch[1]) continue;
    const dia = parseInt(diaMatch[1]);
    if (dia < 1 || dia > 31) continue;
    if (vistos[dia]) continue;               // protege contra linhas de total repetindo o dia
    vistos[dia] = true;

    // No mes corrente, dias que ainda nao chegaram nao entram na conta.
    // (A planilha costuma ter o trafego fixo lancado no mes inteiro.)
    if (isMesCorrente && dia > diaHoje) { result.diasFuturosIgnorados++; continue; }

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

    if (isMesCorrente && dia === diaHoje) {
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
    const anoAtual = br.getFullYear();

    _abasCache = null; // uma descoberta por invocacao

    // Somente meses ja iniciados (1..mes corrente).
    const meses = [];
    for (let m = 1; m <= mesAtual; m++) meses.push(m);
    const fetched = await Promise.all(meses.map(m => getMesCSV(m).catch(() => null)));

    const historico = {};
    const fontes = {};
    let mesData = null;
    const avisos = [];

    for (let idx = 0; idx < meses.length; idx++) {
      const m = meses[idx];
      const f = fetched[idx];
      if (!f) { avisos.push('Aba de ' + NOMES[m] + ' não encontrada na planilha'); continue; }
      if (f.erroMes) {
        avisos.push('Aba de ' + NOMES[m] + ' não encontrada (a planilha devolveu ' + f.erroMes + ')');
        continue;
      }

      const rows = parseCSV(f.csv);
      const data = processMes(rows, diaHoje, mesAtual, m);
      historico[m] = { nome: NOMES[m], ...data };
      fontes[m] = f.via + (f.conferido ? '' : ' (sem conferencia de data)');
      if (m === mesAtual) mesData = data;
    }

    // Sem o mes corrente o painel nao deve morrer: mostra o ultimo mes disponivel.
    let mesExibido = mesAtual;
    if (!mesData) {
      const disponiveis = Object.keys(historico).map(Number).sort((a,b) => b-a);
      if (!disponiveis.length) throw new Error('Nenhum mês encontrado na planilha');
      mesExibido = disponiveis[0];
      mesData = historico[mesExibido];
      avisos.push('Exibindo ' + NOMES[mesExibido] + ' (aba de ' + NOMES[mesAtual] + ' ainda não existe)');
    }

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
      mesNumero: mesExibido,
      mesNome: NOMES[mesExibido],
      ano: anoAtual,
      diasFuturosIgnorados: mesData.diasFuturosIgnorados || 0,
      avisos: avisos,
      fontes: fontes,
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
