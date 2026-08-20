// bridge.js — mesmo contrato e MESMOS TIPOS do Apps Script antigo:
//   GET /api/bridge?aba=AGOSTO&range=A3:L35 -> { data: [[...]] }
// Numeros voltam como numero, datas como ISO, vazio como "".

const SHEET_ID = '1aPgEdIQbPaCOUIieQ3Yb9IS4mMlBKFlXNmtEdBWJISs';
const TZ_PLANILHA = 'America/Los_Angeles';   // fuso configurado na planilha

const GID_MAP = {
  JANEIRO: 1930056113, FEVEREIRO: 139141619, MARCO: 394024566, ABRIL: 1775302632,
  MAIO: 1874931146, JUNHO: 1904737424, JULHO: 1460532624, AGOSTO: 1775966737
};
const MESES = ['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO',
               'JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];

function normalizar(s) {
  return String(s || '').trim().toUpperCase()
    .replace(/[ÁÀÂÃÄ]/g,'A').replace(/[ÉÈÊË]/g,'E').replace(/[ÍÌÎÏ]/g,'I')
    .replace(/[ÓÒÔÕÖ]/g,'O').replace(/[ÚÙÛÜ]/g,'U').replace(/Ç/g,'C');
}

function mesAtualBR() {
  const n = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: 'numeric' }).format(new Date());
  return MESES[Number(n) - 1];
}

function parseRange(range) {
  const m = String(range || '').toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  const col = (l) => { let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n; };
  return { c1: col(m[1]), r1: Number(m[2]), c2: col(m[3]), r2: Number(m[4]) };
}

// deslocamento (minutos) do fuso da planilha num instante
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

// "Date(2026,7,1)" -> ISO do instante correspondente na planilha
function dataParaISO(v) {
  const m = String(v).match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/);
  if (!m) return String(v);
  const [y, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [hh, mm, ss] = [Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)];
  let t = Date.UTC(y, mes, d, hh, mm, ss);
  t = Date.UTC(y, mes, d, hh, mm, ss) - offsetMin(t) * 60000;
  t = Date.UTC(y, mes, d, hh, mm, ss) - offsetMin(t) * 60000;
  return new Date(t).toISOString();
}

function valorDaCelula(c) {
  if (!c || c.v === null || c.v === undefined || c.v === '') return '';
  if (typeof c.v === 'number') return c.v;
  if (typeof c.v === 'boolean') return c.v;
  if (typeof c.v === 'string' && /^Date\(/.test(c.v)) return dataParaISO(c.v);
  return c.v;
}

async function tabelaGviz(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const t = await r.text();
    const i = t.indexOf('('), f = t.lastIndexOf(')');
    if (i < 0 || f <= i) return null;
    const j = JSON.parse(t.slice(i + 1, f));
    if (j.status !== 'ok' || !j.table) return null;
    return j.table;
  } catch (e) { return null; }
}

async function tabelaDaAba(aba) {
  const k = normalizar(aba);
  const base = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:json&headers=0';
  if (GID_MAP[k]) {
    const t = await tabelaGviz(base + '&gid=' + GID_MAP[k]);
    if (t) return t;
  }
  if (MESES.indexOf(k) === -1) return null;
  const nomes = k === 'MARCO' ? ['MAR%C3%87O', 'MARCO'] : [encodeURIComponent(aba), k];
  for (const n of nomes) {
    const t = await tabelaGviz(base + '&sheet=' + n);
    if (t) return t;
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const url = new URL(req.url, 'http://x');
    const aba = url.searchParams.get('aba') || mesAtualBR();
    const range = url.searchParams.get('range') || 'A3:L35';

    const r = parseRange(range);
    if (!r) return res.status(200).json({ erro: 'range invalido: ' + range });

    const tabela = await tabelaDaAba(aba);
    if (!tabela) return res.status(200).json({ erro: 'aba nao encontrada: ' + aba });

    const linhas = tabela.rows || [];
    const data = [];
    for (let L = r.r1; L <= r.r2; L++) {
      const cs = (linhas[L - 1] && linhas[L - 1].c) || [];
      const saida = [];
      for (let C = r.c1; C <= r.c2; C++) saida.push(valorDaCelula(cs[C - 1]));
      data.push(saida);
    }
    return res.status(200).json({ data });
  } catch (e) {
    return res.status(200).json({ erro: String((e && e.message) || e) });
  }
}
