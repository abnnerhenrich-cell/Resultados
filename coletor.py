import json
import re
import unicodedata
from datetime import datetime
import requests
from bs4 import BeautifulSoup

FIREBASE_PROJECT_ID = "resultados-loterias-3979a"
FIREBASE_URL = f"https://firestore.googleapis.com/v1/projects/{FIREBASE_PROJECT_ID}/databases/(default)/documents/resultados"

LOTERIAS = [
    ("LOTERIA TRADICIONAL", "https://www.resultadofacil.com.br/resultados-loteria-tradicional-de-hoje"),
    ("LOTERIA NACIONAL", "https://www.resultadofacil.com.br/resultados-da-banca-loteria-nacional"),
    ("MALUCA BAHIA", "https://www.resultadofacil.com.br/resultados-maluca-bahia-de-hoje"),
    ("PARATODOS BAHIA", "https://www.resultadofacil.com.br/resultados-paratodos-bahia-de-hoje"),
    ("LOTECE", "https://www.resultadofacil.com.br/resultados-lotece---loteria-dos-sonhos-de-hoje"),
    ("PARATODOS CEARÁ", "https://www.resultadofacil.com.br/resultados-paratodos-ce-de-hoje"),
    ("LBR", "https://www.resultadofacil.com.br/resultados-lbr-de-hoje"),
    ("BOA SORTE GOIÁS", "https://www.resultadofacil.com.br/resultados-boa-sorte-de-hoje"),
    ("LOOK LOTERIAS", "https://www.resultadofacil.com.br/resultados-look-loterias-de-hoje"),
    ("MINAS MG", "https://www.resultadofacil.com.br/resultados-minas-mg-de-hoje"),
    ("CAMPINA GRANDE PB", "https://www.resultadofacil.com.br/resultados-campina-grande-de-hoje"),
    ("LOTEP", "https://www.resultadofacil.com.br/resultados-lotep-de-hoje"),
    ("PARATODOS PB", "https://www.resultadofacil.com.br/resultados-paratodos-pb-de-hoje"),
    ("AVAL PERNAMBUCO", "https://www.resultadofacil.com.br/resultados-aval-pernambuco-de-hoje"),
    ("CAMINHO DA SORTE", "https://www.resultadofacil.com.br/resultados-caminho-da-sorte-de-hoje"),
    ("LOTERIA POPULAR", "https://www.resultadofacil.com.br/resultados-loteria-popular-de-hoje"),
    ("NORDESTE MONTE CARLOS", "https://www.resultadofacil.com.br/resultados-nordeste-monte-carlos-de-hoje"),
    ("PT-RIO", "https://www.resultadofacil.com.br/resultados-pt-rio-de-hoje"),
    ("BASE PREMIA RN", "https://www.resultadofacil.com.br/resultados-base-premia-de-hoje"),
    ("BICHO RS", "https://www.resultadofacil.com.br/resultados-rio-grande-do-sul-de-hoje"),
    ("ABAESE ITABAIANA", "https://www.resultadofacil.com.br/resultados-abaese---itabaiana-paratodos-de-hoje"),
    ("BANDEIRANTES", "https://www.resultadofacil.com.br/resultados-bandeirantes-de-hoje"),
    ("PT-SP", "https://www.resultadofacil.com.br/resultados-pt-sp-de-hoje"),
    ("LOTERIA NACIONAL HOJE", "https://www.resultadofacil.com.br/resultados-loteria-nacional-de-hoje"),
]

def limpar(txt):
    return re.sub(r"\s+", " ", str(txt or "")).strip()

def normalizar(txt):
    txt = unicodedata.normalize("NFD", str(txt or ""))
    txt = txt.encode("ascii", "ignore").decode("utf-8")
    return txt.lower()

def slug(txt):
    txt = normalizar(txt)
    return re.sub(r"[^a-z0-9]+", "-", txt).strip("-")

def extrair_data(txt):
    m = re.search(r"(\d{2}/\d{2}/\d{4})", txt)
    return m.group(1) if m else datetime.now().strftime("%d/%m/%Y")

def extrair_hora(txt):
    t = normalizar(txt)
    m = re.search(r"(\d{1,2})\s*[:h]\s*(\d{2})", t)
    if m:
        return m.group(1).zfill(2) + ":" + m.group(2)
    m = re.search(r"(\d{1,2})\s*hs?", t)
    if m:
        return m.group(1).zfill(2) + ":00"
    return ""

def data_ordenacao(data, hora):
    try:
        return int(datetime.strptime(data + " " + hora, "%d/%m/%Y %H:%M").timestamp())
    except:
        return int(datetime.now().timestamp())

def titulo_valido(txt):
    t = normalizar(txt)
    if "resultado do dia" not in t:
        return False
    if len(txt) > 220:
        return False
    bloqueios = ["function", "window", "document", "print", "script", "__", "var ", "const "]
    return not any(b in t for b in bloqueios)

def pegar_tabelas(nome_loteria, url):
    headers = {
        "User-Agent": "Mozilla/5.0"
    }

    html = requests.get(url, headers=headers, timeout=40).text
    soup = BeautifulSoup(html, "lxml")

    resultados = []

    possiveis_titulos = soup.find_all(["h1", "h2", "h3", "h4", "h5", "p", "strong", "b", "div"])

    for titulo_tag in possiveis_titulos:
        titulo = limpar(titulo_tag.get_text(" "))

        if not titulo_valido(titulo):
            continue

        tabela = titulo_tag.find_next("table")

        if not tabela:
            continue

        premios = []

        for tr in tabela.find_all("tr"):
            colunas = [limpar(td.get_text(" ")) for td in tr.find_all("td")]
            colunas = [c for c in colunas if c]

            if len(colunas) < 3:
                continue

            texto_linha = " ".join(colunas)
            m = re.search(r"\b\d{4}\b", texto_linha)

            if not m:
                continue

            if len(premios) < 5:
                premios.append({
                    "posicao": colunas[0],
                    "milhar": m.group(0),
                    "bicho": colunas[-1]
                })

        if len(premios) != 5:
            continue

        data = extrair_data(titulo)
        hora = extrair_hora(titulo)

        resultados.append({
            "loteria": nome_loteria,
            "titulo": titulo,
            "data": data,
            "hora": hora,
            "dataOrdenacao": data_ordenacao(data, hora),
            "atualizadoFonte": data + (" às " + hora if hora else ""),
            "fonte": "resultadofacil.com.br",
            "urlOriginal": url,
            "premios": premios
        })

    return resultados

def salvar(resultado):
    doc_id = slug(
        resultado["loteria"] + "-" +
        resultado["titulo"] + "-" +
        resultado["data"] + "-" +
        resultado["hora"]
    )

    body = {
        "fields": {
            "loteria": {"stringValue": resultado["loteria"]},
            "titulo": {"stringValue": resultado["titulo"]},
            "data": {"stringValue": resultado["data"]},
            "hora": {"stringValue": resultado["hora"]},
            "dataOrdenacao": {"integerValue": str(resultado["dataOrdenacao"])},
            "atualizadoFonte": {"stringValue": resultado["atualizadoFonte"]},
            "fonte": {"stringValue": resultado["fonte"]},
            "urlOriginal": {"stringValue": resultado["urlOriginal"]},
            "premios": {"stringValue": json.dumps(resultado["premios"], ensure_ascii=False)},
            "createdAt": {"integerValue": str(int(datetime.now().timestamp()))}
        }
    }

    r = requests.patch(
        FIREBASE_URL + "/" + doc_id,
        headers={"Content-Type": "application/json"},
        data=json.dumps(body),
        timeout=30
    )

    print("Firebase:", r.status_code, resultado["loteria"], resultado["hora"], resultado["titulo"])

def main():
    total = 0

    for nome, url in LOTERIAS:
        try:
            resultados = pegar_tabelas(nome, url)
            print(nome, "encontrados:", len(resultados))

            for resultado in resultados:
                salvar(resultado)
                total += 1

        except Exception as e:
            print("Erro em", nome, str(e))

    print("Total enviados:", total)

if __name__ == "__main__":
    main()
