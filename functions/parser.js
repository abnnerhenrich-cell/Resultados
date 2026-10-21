const cheerio = require("cheerio");

const TZ = "America/Sao_Paulo";

// Só estas loterias são publicadas (evita tabelas de anúncio/lixo).
// Para incluir outra, adicione uma linha: ["NOME NO SITE", /TEXTO_SEM_ACENTO_EM_MAIUSCULO/]
const LOTERIAS = [
  ["PT-RIO", /PT[\s-]*RIO|RIO DE JANEIRO/],
  ["PT-SP", /PT[\s-]*SP|SAO PAULO/],
  ["LOOK LOTERIAS", /LOOK/],
  ["BANDEIRANTES", /BANDEIRANTE/],
  ["LOTECE", /LOTECE/],
  ["MALUCA BAHIA", /MALUCA/],
  ["BOA SORTE GOIÁS", /BOA SORTE/]
];

const BICHOS = ["Avestruz","Águia","Burro","Borboleta","Cachorro","Cabra","Carneiro","Camelo","Cobra","Coelho","Cavalo","Elefante","Galo","Gato","Jacaré","Leão","Macaco","Porco","Pavão","Peru","Touro","Tigre","Urso","Veado","Vaca"];

const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
const hojeISO = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

function nomeLoteria(titulo){
  const t = semAcento(titulo);
  const f = LOTERIAS.find(([, re]) => re.test(t));
  return f ? f[0] : null;
}

function bichoDaMilhar(milhar){
  const dezena = Number(String(milhar).slice(-2));
  return BICHOS[(dezena === 0 ? 25 : Math.ceil(dezena / 4)) - 1] || "";
}

function achaData(texto){
  const m = String(texto || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { iso: `${m[3]}-${m[2]}-${m[1]}`, br: m[0] } : null;
}

function achaHora(texto){
  const m = String(texto || "").match(/\b([01]?\d|2[0-3])\s*(?:h|:)\s*([0-5]\d)?/i);
  return m ? `${m[1].padStart(2, "0")}:${m[2] || "00"}` : null;
}

// Posições 1..N seguidas (N entre 5 e 10) e milhares com exatamente 4 dígitos.
function premiosValidos(premios){
  if(!Array.isArray(premios) || premios.length < 5 || premios.length > 10) return false;
  return premios.every((p, i) =>
    p && /^\d{4}$/.test(String(p.milhar)) && parseInt(p.posicao, 10) === i + 1);
}

function tituloDe($, table){
  const cap = $(table).find("caption").first().text().trim();
  if(cap) return cap;
  let el = $(table);
  for(let i = 0; i < 4; i++){
    const h = el.prevAll("h1,h2,h3,h4,h5").first().text().trim();
    if(h) return h;
    el = el.parent();
  }
  return "";
}

function parseResults(html){
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();

  const dataPagina = achaData($("body").text().slice(0, 4000));
  const hoje = hojeISO();
  const cards = [], rejeitados = [], vistos = new Set();

  $("table").each((idx, table) => {
    const titulo = tituloDe($, table);
    const topo = `${titulo} ${$(table).find("tr").first().text()}`;
    const rotulo = titulo || `tabela ${idx + 1}`;

    const loteria = nomeLoteria(titulo || topo);
    if(!loteria) return rejeitados.push({ tabela: rotulo, motivo: "loteria não reconhecida" });

    const premios = [];
    $(table).find("tr").each((_, tr) => {
      const cells = $(tr).find("td,th").map((__, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
      const pos = (cells[0] || "").match(/^(\d{1,2})\s*[ºo°ª]?(\s*pr[eê]mio)?$/i);
      const milhar = cells.slice(1).find(c => /^\d{4}$/.test(c));
      if(pos && milhar) premios.push({ posicao: `${parseInt(pos[1], 10)}º`, milhar, bicho: bichoDaMilhar(milhar) });
    });
    if(!premiosValidos(premios)) return rejeitados.push({ tabela: rotulo, motivo: `prêmios inválidos/incompletos (${premios.length} lidos)` });

    const data = achaData(topo) || dataPagina;
    if(!data) return rejeitados.push({ tabela: rotulo, motivo: "data não encontrada" });
    const dias = Math.round((Date.parse(hoje) - Date.parse(data.iso)) / 864e5);
    if(dias < 0 || dias > 3) return rejeitados.push({ tabela: rotulo, motivo: `data fora do esperado (${data.br})` });

    const hora = achaHora(topo);
    if(!hora) return rejeitados.push({ tabela: rotulo, motivo: "horário não encontrado" });

    const chave = `${loteria}|${data.iso}|${hora}`;
    if(vistos.has(chave)) return rejeitados.push({ tabela: rotulo, motivo: "duplicado" });
    vistos.add(chave);

    cards.push({
      titulo: loteria, loteria, hora, data: data.br, dataISO: data.iso,
      dataOrdenacao: Date.parse(`${data.iso}T${hora}:00-03:00`), // Brasil sem horário de verão
      premios
    });
  });

  return { cards, rejeitados };
}

module.exports = { parseResults, premiosValidos, nomeLoteria, TZ, LOTERIAS };
