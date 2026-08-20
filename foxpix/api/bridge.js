// bridge.js — FOX PIX (mesmo contrato do app):
//   GET /api/bridge?aba=AGOSTO&range=A3:L35 -> { data: [[...]] }
// A planilha da Fox tem as faixas em ordem diferente da Alien; aqui as
// colunas F/G/H sao reordenadas para o app enxergar 10 / 19,90 / 24,90.

const SHEET_ID = '1j_ZANhnTaSVmAMpP2OM2LKo6Wbq0tFP0cTs2Ck0qXNw';
const TZ_PLANILHA = 'America/Los_Angeles';

const GID_MAP = {
  JANEIRO: 1120750679, FEVEREIRO: 789516197, MARCO: 1736046432,
  ABRIL: 763503663, MAIO: 923945500, JUNHO: 926032448, JULHO: 1673745313
};
const MESES = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO',
               'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
const ABREV = { jan:0, fev:1, mar:2, abr:3, mai:4, jun:5, jul:6, ago:7, set:8, out:9, nov:10, dez:11 };
const ABREV_DO_MES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

// planilha Fox: F=19,90  G=24,90  H=10   ->  app espera F=10  G=19,90  H=24,90
const ORDEM = { 6: 8, 7: 6, 8: 7 };

function normalizar(s) {
  return String(s || '').trim().toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ç/g,'C');
}

function agoraSP() {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { ano: Number(p.year), mes: Number(p.month) };
}

function parseRange(range) {
  const m = String(range || '').toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = (l) => { let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n; };
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

function offsetMin(t) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ_PLANILHA, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(t)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const h = p.hour === '24' ? 0 : Number(p.hour);
  const comoUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), h, Number(p.minute), Number(p.second));
  return (comoUTC - t) / 60000;
}

function isoDaData(ano, mes, dia) {
  let t = Date.UTC(ano, mes, dia);
  t = Date.UTC(ano, mes, dia) - offsetMin(t) * 60000;
  t = Date.UTC(ano, mes, dia) - offsetMin(t) * 60000;
  return new Date(t).toISOString();
}

function paraNumero(txt) {
  let t = String(txt).trim();
  if (!t) return null;
  let pct = false;
  if (/%$/.test(t)) { pct = true; t = t.slice(0, -1).trim(); }
  t = t.replace(/R\$/g, '').replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(t)) return null;
  let n;
  if (t.indexOf(',') > -1) n = parseFloat(t.replace(/\./g, '').replace(',', '.'));
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) n = parseFloat(t.replace(/\./g, ''));
  else n = parseFloat(t);
  if (isNaN(n)) return null;
  return pct ? n / 100 : n;
}

function paraData(txt, anoRef) {
  const t = String(txt).trim().toLowerCase();
  let m = t.match(/^(\d{1,2})[-\/\s]([a-zç]{3})\.?$/);
  if (m && ABREV[m[2]] !== undefined) return isoDaData(anoRef, ABREV[m[2]], Number(m[1]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const ano = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoDaData(ano, Number(m[2]) - 1, Number(m[1]));
  }
  return null;
}

function converter(txt, anoRef) {
  if (txt === undefined || txt === null || String(txt) === '') return '';
  const d = paraData(txt, anoRef);
  if (d) return d;
  const n = paraNumero(txt);
  if (n !== null) return n;
  return String(txt);
}

function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function pareceCSV(t) {
  if (!t) return false;
  const h = t.slice(0, 200);
  if (/^\s*[<{]/.test(h)) return false;
  if (/google\.visualization|invalid_query|Bad Request/i.test(h)) return false;
  return true;
}

// confere se o CSV e mesmo do mes pedido (o gviz devolve a 1a aba quando o nome nao existe)
function csvEhDoMes(csv, mesIdx) {
  const alvo = ABREV_DO_MES[mesIdx];
  const linhas = parseCSV(csv).slice(0, 12);
  for (const l of linhas) {
    const a = String((l && l[0]) || '').trim().toLowerCase();
    const m = a.match(/^(\d{1,2})[-\/\s]([a-zç]{3})\.?$/);
    if (m) return m[2] === alvo;
    const m2 = a.match(/^(\d{1,2})\/(\d{1,2})\//);
    if (m2) return Number(m2[2]) - 1 === mesIdx;
  }
  return false;
}

async function baixar(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const t = await r.text();
    return pareceCSV(t) ? t : null;
  } catch (e) { return null; }
}

async function csvDaAba(aba) {
  const k = normalizar(aba);
  const idx = MESES.indexOf(k);
  if (idx === -1) return null;
  if (GID_MAP[k]) {
    const c = await baixar('https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/export?format=csv&gid=' + GID_MAP[k]);
    if (c) return c;
  }
  const cap = k.charAt(0) + k.slice(1).toLowerCase();
  const variantes = k === 'MARCO'
    ? ['MARÇO', 'Março', 'MARCO', 'Marco']
    : [k, cap, String(aba)];
  for (const nome of variantes) {
    const c = await baixar('https://docs.google.com/spreadsheets/d/' + SHEET_ID +
                           '/gviz/tq?tqx=out:csv&headers=0&sheet=' + encodeURIComponent(nome));
    if (c && csvEhDoMes(c, idx)) return c;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://x');
    const hoje = agoraSP();
    const aba = url.searchParams.get('aba') || MESES[hoje.mes - 1];
    const range = url.searchParams.get('range') || 'A3:L35';

    const r = parseRange(range);
    if (!r) return res.status(200).json({ erro: 'range invalido: ' + range });

    const csv = await csvDaAba(aba);
    if (!csv) return res.status(200).json({ erro: 'aba nao encontrada: ' + aba });

    const linhas = parseCSV(csv);
    const data = [];
    for (let L = r.r1; L <= r.r2; L++) {
      const orig = linhas[L - 1] || [];
      const saida = [];
      for (let C = r.c1; C <= r.c2; C++) {
        const fonte = ORDEM[C] || C;
        saida.push(converter(orig[fonte - 1], hoje.ano));
      }
      data.push(saida);
    }
    return res.status(200).json({ data });
  } catch (e) {
    return res.status(200).json({ erro: String((e && e.message) || e) });
  }
}
