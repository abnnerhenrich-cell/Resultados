const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const cheerio = require("cheerio");

admin.initializeApp();
const db = admin.firestore();

const SOURCE_URL = "https://www.ojogodobicho.com/resultados.htm";

/*
  IMPORTANTE:
  Este coletor é um modelo genérico.
  Como cada site tem um HTML diferente, talvez você precise ajustar os seletores dentro de parseResults().
  Use somente se a coleta for permitida pelos termos do site.
*/

function guessBichoFromMilhar(milhar){
  const bichos = {
    1:"Avestruz",2:"Águia",3:"Burro",4:"Borboleta",5:"Cachorro",
    6:"Cabra",7:"Carneiro",8:"Camelo",9:"Cobra",10:"Coelho",
    11:"Cavalo",12:"Elefante",13:"Galo",14:"Gato",15:"Jacaré",
    16:"Leão",17:"Macaco",18:"Porco",19:"Pavão",20:"Peru",
    21:"Touro",22:"Tigre",23:"Urso",24:"Veado",25:"Vaca"
  };
  const n = String(milhar || "").replace(/\D/g, "");
  if(n.length < 2) return "";
  const dezena = Number(n.slice(-2));
  const grupo = dezena === 0 ? 25 : Math.ceil(dezena / 4);
  return bichos[grupo] || "";
}

function parseResults(html){
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  // Tenta encontrar blocos por títulos comuns.
  const cards = [];

  $("table").each((idx, table) => {
    const premios = [];
    $(table).find("tr").each((i, tr) => {
      const cells = $(tr).find("td").map((_, td) => $(td).text().trim()).get();
      const joined = cells.join(" ");
      const milhar = (joined.match(/\b\d{4}\b/) || [])[0];

      if(milhar){
        premios.push({
          posicao: cells[0] || `${premios.length + 1}º`,
          milhar,
          bicho: guessBichoFromMilhar(milhar)
        });
      }
    });

    if(premios.length){
      const previousTitle = $(table).prevAll("h1,h2,h3,h4").first().text().trim();
      cards.push({
        titulo: previousTitle || `Resultado ${idx + 1}`,
        data: new Date().toLocaleDateString("pt-BR"),
        fonte: "ojogodobicho.com",
        premios
      });
    }
  });

  // Fallback: pega qualquer sequência de milhares no texto.
  if(!cards.length){
    const milhares = [...new Set((text.match(/\b\d{4}\b/g) || []))].slice(0, 7);
    if(milhares.length){
      cards.push({
        titulo: "Resultado coletado",
        data: new Date().toLocaleDateString("pt-BR"),
        fonte: "ojogodobicho.com",
        premios: milhares.map((m, i) => ({
          posicao: `${i + 1}º`,
          milhar: m,
          bicho: guessBichoFromMilhar(m)
        }))
      });
    }
  }

  return cards;
}

async function scrapeAndSave(){
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 ResultadoBot/1.0",
      "Accept": "text/html"
    }
  });

  if(!res.ok){
    throw new Error(`Falha ao acessar fonte: ${res.status}`);
  }

  const html = await res.text();
  const cards = parseResults(html);

  if(!cards.length){
    throw new Error("Nenhum resultado foi encontrado. Ajuste os seletores do parseResults().");
  }

  const batch = db.batch();

  for(const card of cards){
    const idBase = `${card.titulo}-${card.data}`.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const ref = db.collection("resultados").doc(idBase || String(Date.now()));
    batch.set(ref, {
      ...card,
      sourceUrl: SOURCE_URL,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await batch.commit();
  return { ok:true, total: cards.length };
}

// Roda automático a cada 5 minutos.
// Para usar scheduler, normalmente o projeto precisa estar no plano Blaze.
exports.coletarResultadosAutomatico = onSchedule("every 5 minutes", async () => {
  await scrapeAndSave();
});

// URL manual para testar no navegador depois do deploy.
exports.coletarResultadosAgora = onRequest(async (req, res) => {
  try{
    const result = await scrapeAndSave();
    res.json(result);
  }catch(err){
    res.status(500).json({ ok:false, error: err.message });
  }
});
