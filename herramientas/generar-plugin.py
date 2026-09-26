# -*- coding: utf-8 -*-
"""Mete catalogo/vanilla.json dentro de plugin/animplayer.js.

Por que va dentro del plugin y no en un archivo aparte
-----------------------------------------------------
Un plugin de SkyrimPlatform es un unico .js y no puede leer archivos del disco:
no hay require, ni fs, ni nada parecido. Lo unico que puede leer de fuera es su
propio archivo de ajustes (animplayer-settings.txt), y ese es el sitio donde el
usuario anade SUS animaciones.

Asi que el catalogo base viaja dentro del codigo. Se sustituye el bloque que hay
entre las dos marcas:

    // >>> CATALOGO GENERADO ... >>>
    // <<< CATALOGO GENERADO <<<

Todo lo que este entre ellas se pisa. El resto del archivo no se toca.

Se escribe compacto a proposito
-------------------------------
Son casi setecientas animaciones. Si cada una llevara sus palabras de busqueda
repetidas (son las de su categoria) el bloque seria tres veces mas grande sin
anadir nada: el plugin ya junta las palabras de la categoria con las de la
ficha al pintar la lista. Por eso aqui se quita todo lo que se pueda deducir:
    - busqueda, cuando es la misma que la de su categoria
    - sincroniza, cuando es true (es el caso normal)
    - destacada, cuando es false
    - origen, cuando es "vanilla"
    - motivo, cuando esta vacio

Uso
    python generar-plugin.py
"""
import json
import io
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)

ENTRADA = os.path.join(RAIZ, "catalogo", "vanilla.json")
DESTINO = os.path.join(RAIZ, "plugin", "animplayer.js")

MARCA_ABRE = "// >>> CATALOGO GENERADO"
MARCA_CIERRA = "// <<< CATALOGO GENERADO <<<"


def compactar(catalogo):
    """Deja solo lo que el plugin no puede deducir por su cuenta."""
    porCategoria = dict((c["clave"], c.get("busqueda", ""))
                        for c in catalogo["categorias"])
    fuera = []
    for a in catalogo["animaciones"]:
        ficha = {"evento": a["evento"], "nombre": a["nombre"],
                 "categoria": a["categoria"]}
        if a.get("busqueda") and a["busqueda"] != porCategoria.get(a["categoria"]):
            ficha["busqueda"] = a["busqueda"]
        if a.get("destacada"):
            ficha["destacada"] = True
        if a.get("sincroniza") is False:
            ficha["sincroniza"] = False
            if a.get("motivo"):
                ficha["motivo"] = a["motivo"]
        fuera.append(ficha)
    return {"version": catalogo.get("version", 1),
            "categorias": catalogo["categorias"],
            "animaciones": fuera}


def comoJs(catalogo):
    """Una linea por animacion: asi el diff de git se lee."""
    lineas = ['  var CATALOGO = {']
    lineas.append('    "version": %d,' % catalogo["version"])
    lineas.append('    "categorias": [')
    for i, c in enumerate(catalogo["categorias"]):
        coma = "," if i < len(catalogo["categorias"]) - 1 else ""
        lineas.append("      " + json.dumps(c, ensure_ascii=False) + coma)
    lineas.append("    ],")
    lineas.append('    "animaciones": [')
    for i, a in enumerate(catalogo["animaciones"]):
        coma = "," if i < len(catalogo["animaciones"]) - 1 else ""
        lineas.append("      " + json.dumps(a, ensure_ascii=False) + coma)
    lineas.append("    ]")
    lineas.append("  };")
    return "\n".join(lineas)


if __name__ == "__main__":
    catalogo = compactar(json.load(io.open(ENTRADA, encoding="utf-8")))
    fuente = io.open(DESTINO, encoding="utf-8").read()

    inicio = fuente.find(MARCA_ABRE)
    fin = fuente.find(MARCA_CIERRA)
    if inicio == -1 or fin == -1:
        raise SystemExit("no encuentro las marcas del catalogo en " + DESTINO)

    # Se conserva la linea de la marca de apertura tal cual, hasta su salto.
    trasMarca = fuente.index("\n", inicio) + 1
    nuevo = fuente[:trasMarca] + comoJs(catalogo) + "\n" + fuente[fin:]
    io.open(DESTINO, "w", encoding="utf-8").write(nuevo)

    print("catalogo metido en", DESTINO)
    print("  %d animaciones, %d categorias" %
          (len(catalogo["animaciones"]), len(catalogo["categorias"])))
    print("  el plugin ocupa ahora %.0f KB" % (len(nuevo) / 1024.0))
