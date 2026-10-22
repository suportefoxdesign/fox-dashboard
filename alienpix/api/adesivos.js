// adesivos.js — ponte entre o painel e o Apps Script (aba ADESIVOS).
//   GET  /api/adesivos                       -> { pedidos:[...] }
//   GET  /api/adesivos?acao=cotacao&l=&a=&q=&cep=&preco=
//   POST /api/adesivos  { acao:'confirmar', pedido, largura, altura, qtd, cep, status, por }
// O token NUNCA aparece no HTML: fica nas variaveis de ambiente da Vercel.

const WEBAPP = process.env.ALIEN_WEBAPP_URL || '';
const TOKEN  = process.env.ALIEN_TOKEN || '';

const ACOES_POST = ['confirmar'];

async function chamar(url, init) {
  const r = await fetch(url, init);
  const txt = await r.text();
  try { return JSON.parse(txt); }
  catch (e) { return { erro: 'resposta nao-JSON do Apps Script', http: r.status, corpo: txt.slice(0, 300) }; }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!WEBAPP || !TOKEN) {
    return res.status(200).json({ erro: 'falta configurar ALIEN_WEBAPP_URL / ALIEN_TOKEN na Vercel' });
  }

  try {
    if (req.method === 'GET') {
      const entrada = new URL(req.url, 'http://x').searchParams;
      const q = new URLSearchParams({ token: TOKEN });
      ['acao', 'l', 'a', 'q', 'cep', 'preco'].forEach(k => {
        const v = entrada.get(k);
        if (v !== null && v !== '') q.set(k, v);
      });
      return res.status(200).json(await chamar(WEBAPP + '?' + q.toString()));
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      if (!body || typeof body !== 'object') body = {};
      if (ACOES_POST.indexOf(String(body.acao)) === -1) {
        return res.status(200).json({ erro: 'acao desconhecida: ' + body.acao });
      }
      const payload = {
        token:   TOKEN,
        acao:    'confirmar',
        pedido:  body.pedido,
        largura: body.largura,
        altura:  body.altura,
        qtd:     body.qtd,
        cep:     body.cep,
        status:  body.status,
        por:     body.por
      };
      return res.status(200).json(await chamar(WEBAPP, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      }));
    }

    return res.status(405).json({ erro: 'metodo nao suportado' });
  } catch (e) {
    return res.status(200).json({ erro: String((e && e.message) || e) });
  }
}
