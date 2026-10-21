const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const { parseResults, premiosValidos, nomeLoteria, TZ } = require("./parser");

admin.initializeApp();
const db = admin.firestore();
const ADMIN_TOKEN = defineSecret("ADMIN_TOKEN");

const SOURCE_URL = "https://www.ojogodobicho.com/resultados.htm";
const DIAS_GUARDAR = 30;

async function baixar(){
  let erro;
  for(let i = 0; i < 3; i++){
    try{
      const res = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ResultadoBot/1.0)", "Accept": "text/html" },
        signal: AbortSignal.timeout(20000)
      });
      if(!res.ok) throw new Error(`Fonte respondeu ${res.status}`);
      return await res.text();
    }catch(e){
      erro = e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw erro;
}

const idDe = c => `${c.loteria}-${c.dataISO}-${c.hora.replace(":", "")}`
  .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// dry=true: só mostra o que seria salvo, sem gravar nada.
async function coletar(dry){
  const { cards, rejeitados } = parseResults(await baixar());
  if(dry) return { ok: true, dry: true, aceitos: cards, rejeitados };

  const agora = new Date().toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  let salvos = 0, jaExistiam = 0;

  for(const card of cards){
    try{
      // create() NUNCA sobrescreve: resultado já publicado não é alterado por leitura errada depois.
      await db.collection("resultados").doc(idDe(card)).create({
        ...card, fonte: "ojogodobicho.com", sourceUrl: SOURCE_URL, atualizadoFonte: agora,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      salvos++;
    }catch(e){
      if(e.code === 6 || /ALREADY_EXISTS/.test(e.message)) jaExistiam++; else throw e;
    }
  }
  console.log(`salvos=${salvos} jaExistiam=${jaExistiam} rejeitados=${rejeitados.length}`, JSON.stringify(rejeitados));
  return { ok: true, salvos, jaExistiam, rejeitados };
}

// Só das 8h às 23h55 (horário de Brasília), a cada 5 minutos.
exports.coletarResultadosAutomatico = onSchedule(
  { schedule: "*/5 8-23 * * *", timeZone: TZ, retryCount: 0, timeoutSeconds: 90, maxInstances: 1 },
  async () => { await coletar(false); }
);

// Apaga resultados com mais de 30 dias (mantém o banco pequeno e barato).
exports.limparAntigos = onSchedule({ schedule: "0 3 * * *", timeZone: TZ, retryCount: 0 }, async () => {
  const corte = Date.now() - DIAS_GUARDAR * 864e5;
  const snap = await db.collection("resultados").where("dataOrdenacao", "<", corte).limit(400).get();
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
});

function protegido(handler){
  return onRequest({ secrets: [ADMIN_TOKEN] }, async (req, res) => {
    if(req.query.token !== ADMIN_TOKEN.value()) return res.status(403).json({ ok: false, error: "token inválido" });
    try{ res.json(await handler(req)); }
    catch(err){ res.status(500).json({ ok: false, error: err.message }); }
  });
}

// Teste: .../coletarResultadosAgora?token=SEU_TOKEN&dry=1  (mostra aceitos e recusados sem gravar)
exports.coletarResultadosAgora = protegido(req => coletar(req.query.dry === "1"));

// Limpa resultados ERRADOS já gravados. Por padrão só lista; para apagar de verdade use &apagar=1
exports.limparInvalidos = protegido(async req => {
  const snap = await db.collection("resultados").get();
  const ruins = snap.docs.filter(d => {
    const x = d.data();
    return !(nomeLoteria(x.loteria) && premiosValidos(x.premios) && typeof x.dataOrdenacao === "number");
  });
  if(req.query.apagar === "1"){
    for(let i = 0; i < ruins.length; i += 400){
      const batch = db.batch();
      ruins.slice(i, i + 400).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
  }
  return { ok: true, total: snap.size, invalidos: ruins.length, apagados: req.query.apagar === "1", ids: ruins.map(d => d.id).slice(0, 100) };
});
