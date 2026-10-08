# -*- coding: utf-8 -*-
u"""Pule la hoja de revision: infinitivos, un solo tiempo verbal y letras.

QUE HACE, EN ORDEN

  1. QUITA LAS CLAUSULAS DE DEPENDENCIA DE LA DESCRIPCION
     Habia 74 descripciones que acababan con una frase del tipo

         "Desplomarse sobre la mesa. Necesita: estar delante de la mesa."

     Eso ya esta en la columna "dependencia", asi que en la descripcion solo
     repite. Se corta desde Necesita / Depende / Requiere / Hace falta hasta
     el final de esa frase.

  2. LOS NOMBRES, EN INFINITIVO
     De las 737 habia 78 que no empezaban por verbo en infinitivo, pero la
     mayoria son etiquetas con nombre propio —"Actitud: cercana", "Preso A: en
     el carro", "Puñetazo con la derecha"— y forzarlas a verbo las cambiaria
     mucho, que es justo lo que no se quiere. Se tocan las que tienen un verbo
     natural detras, que son las once aceptadas mas unas pocas sueltas.

  3. LAS DESCRIPCIONES, TODAS EN INFINITIVO
     184 de las 227 aceptadas ya empezaban asi, o sea que el infinitivo era ya
     el tiempo de la casa; lo que habia era un puñado sueltas en presente
     ("Cae al suelo...", "Estira tus brazos..."). Se pasan al infinitivo con
     una tabla de conjugados, mas tres que habia que reescribir a mano porque
     no son un cambio de palabra.

     Las que empiezan por un sustantivo —"Ataque con...", "Remate: ..."— no se
     tocan: no son otro tiempo verbal, son otra construccion.

  4. LAS REPETIDAS, CON LETRA
     Donde habia "Baile", "Baile 2", "Baile (3)" —mezclados, y el primero sin
     nada— queda "Baile (A)", "Baile (B)", "Baile (C)". La letra va al final
     y SIEMPRE: si un nombre se repite, ninguna de las copias se queda sin
     letra, que era lo confuso de antes.

Uso
    python pulir-hoja.py

Lee  catalogo/revisado-nuevo.csv   (lo que se baja de Google)
Deja catalogo/hoja-pulida.csv      (para volver a subirlo)
"""
import csv
import io
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
ENTRADA = os.path.join(RAIZ, "catalogo", "revisado-nuevo.csv")
SALIDA = os.path.join(RAIZ, "catalogo", "hoja-pulida.csv")

COLUMNAS = ["id", "nombre", u"descripción", "estado", "nota", "dependencia",
            "editorId"]


# ===================================================== 1. las dependencias

# Se corta desde la palabra hasta el final de la frase. El punto final se
# conserva si la descripcion ya lo tenia antes.
CLAUSULA = re.compile(
    u"[\\s.;,]*\\b(necesita|necesitas|depende|dependes|requiere|requieres|"
    u"hace falta|hacen falta)\\b[^.]*\\.?",
    re.I | re.U)


def sinDependencias(texto):
    u"""Quita las frases de "Necesita: ..." y compañia."""
    fuera = CLAUSULA.sub(u"", texto or u"")
    return re.sub(u"\\s+", u" ", fuera).strip(u" .,;") or u""


# ===================================================== 2. y 3. el infinitivo

# Conjugado -> infinitivo. Solo la primera palabra de la descripcion, que es
# la que marca el tiempo.
AL_INFINITIVO = {
    u"abraza": u"Abrazar", u"abre": u"Abrir", u"acciona": u"Accionar",
    u"analiza": u"Analizar", u"aplaude": u"Aplaudir", u"apoya": u"Apoyar",
    u"ara": u"Arar", u"ataca": u"Atacar", u"avanza": u"Avanzar",
    u"barre": u"Barrer", u"cae": u"Caer", u"carga": u"Cargar",
    u"cierra": u"Cerrar", u"cincela": u"Cincelar", u"come": u"Comer",
    u"comienza": u"Comenzar", u"corta": u"Cortar",
    u"desenfunda": u"Desenfundar", u"desenvaina": u"Desenvainar",
    u"dispara": u"Disparar", u"empieza": u"Empezar", u"envaina": u"Envainar",
    u"estira": u"Estirar", u"exhala": u"Exhalar", u"fuerza": u"Forzar",
    u"golpea": u"Golpear", u"guarda": u"Guardar", u"habla": u"Hablar",
    u"incrementa": u"Incrementar", u"inicia": u"Iniciar", u"lanza": u"Lanzar",
    u"lee": u"Leer", u"levanta": u"Levantar", u"lleva": u"Llevar",
    u"mueve": u"Mover", u"rebuscando": u"Rebuscar", u"rellena": u"Rellenar",
    u"remata": u"Rematar", u"retrocede": u"Retroceder", u"revisa": u"Revisar",
    u"saca": u"Sacar", u"salta": u"Saltar", u"suelta": u"Soltar",
    u"termina": u"Terminar", u"toma": u"Tomar", u"usa": u"Usar",
    u"voltea": u"Voltear",
}

# Reflexivos: "Se acuesta en un saco" -> "Acostarse en un saco".
REFLEXIVOS = {
    u"acuesta": u"Acostarse", u"ejecuta": u"Ejecutarse",
    u"mete": u"Meterse", u"cortan": u"Cortarse", u"levanta": u"Levantarse",
}

# Y las que no son un cambio de palabra, sino de frase.
A_MANO = {
    u"Eres empujado y retrocedes del golpe":
        u"Retroceder al ser empujado por un golpe",
    u"Arrodillate para rezar": u"Arrodillarse para rezar",
    u"Fade-outanimación de cuando caminas":
        u"Fade-out de la animación de caminar",
}

PRIMERA = re.compile(u"^([A-Za-zÁÉÍÓÚÑáéíóúñ-]+)(.*)$", re.U | re.S)


def enInfinitivo(texto):
    u"""Pasa la descripcion al infinitivo, si sabe como."""
    texto = (texto or u"").strip()
    if not texto:
        return texto
    if texto in A_MANO:
        return A_MANO[texto]

    m = PRIMERA.match(texto)
    if not m:
        return texto
    palabra, resto = m.group(1), m.group(2)

    # "Se acuesta en ..." -> "Acostarse en ..."
    if palabra.lower() == u"se":
        m2 = PRIMERA.match(resto.lstrip())
        if m2 and m2.group(1).lower() in REFLEXIVOS:
            return REFLEXIVOS[m2.group(1).lower()] + m2.group(2)
        return texto

    nuevo = AL_INFINITIVO.get(palabra.lower())
    return (nuevo + resto) if nuevo else texto


# Los nombres que si tienen un verbo natural detras. Los que son etiquetas
# —"Actitud: cercana", "Preso A: en el carro"— se quedan como estan: no hay
# verbo que sacar sin reescribirlas enteras.
NOMBRES = {
    u"Rabieta pataleando": u"Patalear con rabia",
    u"Herido": u"Estar herido",
    u"Herido 2": u"Estar herido 2",
    u"Herido 3": u"Estar herido 3",
    u"Herido 4": u"Estar herido 4",
    u"Atado de pie": u"Estar atado de pie",
    u"Atado a un poste": u"Estar atado a un poste",
    u"Golpea suelo": u"Golpear el suelo",
    u"Brazos cruzados (Sentado)": u"Cruzar los brazos (Sentado)",
    u"Brazos cruzados 2 (Sentado)": u"Cruzar los brazos 2 (Sentado)",
    u"Cambio de pose (Sentado)": u"Cambiar de pose (Sentado)",
    u"Cambio de pose 2 (Sentado)": u"Cambiar de pose 2 (Sentado)",
    u"Paseo de cámara": u"Pasear la cámara",
    u"Fin del paseo de cámara": u"Terminar el paseo de cámara",
    u"Fin de la escena en pareja": u"Terminar la escena en pareja",
    u"Guardia de la ejecución": u"Vigilar la ejecución",
    u"Ante una estatua": u"Rezar ante una estatua",
}


# ===================================================== 4. las letras

LETRAS = u"ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# Un numero al final, o justo antes de un parentesis final: "Baile 2",
# "Baile (2)", "Brazos cruzados 2 (Sentado)".
#
# El decimal cuenta como numero: habia dos filas "Retroceder por golpe 3.2" y
# sin esto quedaban en un grupo aparte del de "Retroceder por golpe 2", que es
# la misma accion y tiene que ir en la misma serie de letras.
NUM = u"(\\d+(?:[.,]\\d+)?)"
NUMERO_FINAL = re.compile(u"\\s*\\(" + NUM + u"\\)\\s*$")
NUMERO_SUELTO = re.compile(u"\\s+" + NUM + u"\\s*$")
NUMERO_ANTES = re.compile(u"\\s+" + NUM + u"\\s*(\\([^()]*\\))\\s*$")
LETRA_FINAL = re.compile(u"\\s*\\(([A-Z])\\)\\s*$")


def partir(nombre):
    u"""(nombreSinNumero, elNumeroQueTenia) para poder ordenarlos."""
    n = (nombre or u"").strip()

    def comoNumero(t):
        return float(t.replace(u",", u"."))

    m = LETRA_FINAL.search(n)
    if m:
        return LETRA_FINAL.sub(u"", n).strip(), float(LETRAS.index(m.group(1)) + 1)

    m = NUMERO_ANTES.search(n)
    if m:
        return (NUMERO_ANTES.sub(u" " + m.group(2), n).strip(),
                comoNumero(m.group(1)))

    m = NUMERO_FINAL.search(n)
    if m:
        return NUMERO_FINAL.sub(u"", n).strip(), comoNumero(m.group(1))

    m = NUMERO_SUELTO.search(n)
    if m:
        return NUMERO_SUELTO.sub(u"", n).strip(), comoNumero(m.group(1))

    return n, 1.0


def ponerLetras(filas):
    u"""Donde un nombre se repite, todas las copias llevan letra.

    Se ordenan por el numero que tuvieran —"Baile", "Baile 2", "Baile (3)"—
    para que las letras salgan en ese mismo orden y no se barajen.
    """
    grupos = {}
    for i, f in enumerate(filas):
        base, num = partir(f["nombre"])
        grupos.setdefault(base, []).append((num, i))

    cuantas = 0
    for base, miembros in grupos.items():
        if len(miembros) < 2:
            # Una sola: se queda con el nombre limpio, sin numero ni letra.
            filas[miembros[0][1]]["nombre"] = base
            continue
        miembros.sort()
        for orden, (num, i) in enumerate(miembros):
            letra = LETRAS[orden] if orden < len(LETRAS) else unicode(orden + 1)
            filas[i]["nombre"] = u"%s (%s)" % (base, letra)
            cuantas += 1
    return cuantas


# ===================================================== todo junto

def main():
    filas = list(csv.DictReader(io.open(ENTRADA, encoding="utf-8-sig")))
    print(u"leidas %d filas de %s" % (len(filas), os.path.basename(ENTRADA)))

    quitadas = cambiadas = renombradas = 0
    for f in filas:
        desc = f.get(u"descripción") or u""
        limpia = sinDependencias(desc)
        if limpia != desc.strip():
            quitadas += 1
        enInf = enInfinitivo(limpia)
        if enInf != limpia:
            cambiadas += 1
        f[u"descripción"] = enInf

        nombre = (f.get("nombre") or u"").strip()
        if nombre in NOMBRES:
            f["nombre"] = NOMBRES[nombre]
            renombradas += 1

    conLetra = ponerLetras(filas)

    with io.open(SALIDA, "w", encoding="utf-8-sig", newline="") as s:
        w = csv.DictWriter(s, fieldnames=COLUMNAS)
        w.writeheader()
        for f in filas:
            w.writerow(dict((c, f.get(c, u"")) for c in COLUMNAS))

    print(u"  descripciones sin la clausula de dependencia: %d" % quitadas)
    print(u"  descripciones pasadas a infinitivo:           %d" % cambiadas)
    print(u"  nombres pasados a infinitivo:                 %d" % renombradas)
    print(u"  nombres repetidos que ahora llevan letra:     %d" % conLetra)
    print(u"escrito %s" % SALIDA)


if __name__ == "__main__":
    main()
