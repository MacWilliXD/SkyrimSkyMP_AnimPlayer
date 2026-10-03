# -*- coding: utf-8 -*-
u"""Genera el CSV completo para la hoja de revision.

Junta tres cosas:

  1. Lo que ya habia revisado en la hoja (nombre, descripcion, estado, nota).
     Eso MANDA: lo escrito a mano no se pisa nunca.
  2. Las animaciones nuevas que han aparecido al barrer el juego entero.
  3. Una columna "dependencia" deducida del evento: de que hace falta para que
     esa animacion se pueda reproducir.

Y pasa todo por el mismo estilo: nombres en infinitivo, descripciones
empezando por verbo, y los sinonimos unificados (acostarse y recostarse son lo
mismo, y tener dos palabras hace que buscar falle).

Entre las que ya estaban y las nuevas va una fila en blanco, para verlas de un
vistazo.

Uso:
    python hoja-completa.py            usa catalogo/revisado.csv
    python hoja-completa.py otra.csv   usa otro CSV de partida
"""
import csv
import io
import json
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
import dependencias
import decisiones
import descartes

# Un conjunto para mirar rapido: se consulta una vez por animacion.
ACEPTADAS = set(decisiones.ACEPTADAS)
import estilo
import neutral

CATALOGO = os.path.join(RAIZ, "catalogo", "vanilla.json")
REVISADO = os.path.join(RAIZ, "catalogo", "revisado.csv")
SALIDA = os.path.join(RAIZ, "catalogo", "hoja-completa.csv")

# dependencia va la ULTIMA, detras de nota: es informacion de apoyo para
# revisar, no algo que se lea en cada fila.
# editorId va detras: es la pista de Bethesda sobre que hace la animacion,
# util al nombrarla y a veces contradice al propio id.
COLUMNAS = ["id", "nombre", "descripción", "estado", "nota",
            "dependencia", "editorId"]


def leerRevisado(ruta):
    if not os.path.isfile(ruta):
        return {}
    with io.open(ruta, encoding="utf-8-sig") as f:
        return dict((fila["id"].strip(), fila)
                    for fila in csv.DictReader(f) if fila.get("id"))


def main():
    ruta = sys.argv[1] if len(sys.argv) > 1 else REVISADO
    revisado = leerRevisado(ruta)
    catalogo = json.load(io.open(CATALOGO, encoding="utf-8"))
    animaciones = catalogo["animaciones"]

    viejas, nuevas = [], []
    for a in animaciones:
        (viejas if a["evento"] in revisado else nuevas).append(a)

    def fila(a):
        previo = revisado.get(a["evento"], {})
        # Lo escrito a mano manda; si no hay nada, lo que trae el catalogo.
        nombre = (previo.get("nombre") or "").strip() or a["nombre"]
        desc = (previo.get("descripción") or "").strip()
        nombreBueno = estilo.nombreBueno(nombre)
        estado = (previo.get("estado") or "").strip()
        nota = (previo.get("nota") or "").strip()
        dep = dependencias.dependencia(a["evento"], a)

        # Los descartes automaticos: remates y jugabilidad. Solo si no has
        # decidido tu otra cosa.
        # Los remates se descartan siempre; el resto solo si no lo decidiste tu.
        fuera, porQue = descartes.descarte(a["evento"], a["categoria"])
        if fuera and (not estado or a["categoria"] == "remates"):
            estado = u"Descartado"
            if not nota:
                nota = porQue

        # Y lo decidido a mano manda sobre todo lo anterior. No hace falta
        # volver a razonarlo: el catalogo ya lo aplico y dejo escrito el
        # motivo. Ver herramientas/decisiones.py.
        if a.get("motivoDescarte"):
            estado = u"Descartado"
            nota = a["motivoDescarte"]
        elif a["nombre"] in ACEPTADAS:
            estado = u"Aceptado"
            if nota == porQue:
                nota = u""      # era la nota de un descarte que ya no vale

        # Todo lo que se lee pasa por el filtro de espanol neutral: nombre,
        # descripcion, nota y dependencia. Ver herramientas/neutral.py.
        return {
            "id": a["evento"],
            "nombre": neutral.neutral(estilo.nombreBueno(nombre)),
            # Si no has escrito descripcion, se deduce una: es mejor que un
            # hueco, sobre todo en las cientos de descartadas.
            "descripción": neutral.neutral(
                estilo.descripcionBuena(desc, nombre) or
                estilo.descripcionDeducida(nombreBueno, a["categoria"], dep)),
            "estado": estado,
            "nota": neutral.neutral(nota),
            "dependencia": neutral.neutral(dep),
            "editorId": a.get("edid", ""),
        }

    viejas.sort(key=lambda a: (a["categoria"], a["nombre"].lower()))
    nuevas.sort(key=lambda a: a["nombre"].lower())

    with io.open(SALIDA, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNAS)
        w.writeheader()
        for a in viejas:
            w.writerow(fila(a))
        w.writerow(dict((c, "") for c in COLUMNAS))      # la fila que separa
        for a in nuevas:
            w.writerow(fila(a))

    print("escrito %s" % SALIDA)
    print("  ya revisadas: %d" % len(viejas))
    print("  nuevas:       %d" % len(nuevas))
    print("  total:        %d filas + 1 en blanco" % (len(viejas) + len(nuevas)))

    conDep = sum(1 for a in animaciones
                 if dependencias.dependencia(a["evento"], a))
    print("  con dependencia: %d de %d" % (conDep, len(animaciones)))


if __name__ == "__main__":
    main()
