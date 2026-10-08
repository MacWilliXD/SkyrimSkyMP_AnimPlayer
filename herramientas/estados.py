# -*- coding: utf-8 -*-
u"""Correcciones de estado que no se pierden al volver a bajar la hoja.

POR QUE NO SE EDITA LA HOJA Y YA
  El circuito es: se baja de Google, se pule aqui, y el archivo pulido se
  vuelve a subir. Si una correccion se escribe solo en el csv de paso, la
  siguiente bajada la borra —en Google sigue el valor viejo— y nadie se entera
  de que se perdio.

  Escrita aqui, se vuelve a aplicar cada vez que se pule, venga la hoja como
  venga. Cuando el valor ya este bien en Google, la linea sobra y se puede
  quitar; dejarla tampoco hace dano, porque dice lo mismo.

SE INDEXA POR ID
  El id no cambia nunca. El nombre si: se le pone letra al repetirse, se pasa
  a infinitivo, se corrige una errata. Una correccion que se pierde porque el
  nombre cambio es peor que no tenerla.
"""

# id -> estado. Lo que se ponga aqui pisa a lo que traiga la hoja.
ESTADOS = {
    # Descartada por error; es una pose de taller normal y corriente.
    "IdleWayShrineWaterScoopEnter": u"Aceptado",
}


def aplicar(filas):
    u"""Pisa el estado de las filas corregidas. Devuelve (hechas, perdidas)."""
    porId = {}
    for f in filas:
        porId.setdefault((f.get("id") or "").strip(), []).append(f)

    hechas, perdidas = 0, []
    for ident, estado in ESTADOS.items():
        if ident not in porId:
            perdidas.append(ident)
            continue
        for f in porId[ident]:
            f["estado"] = estado
            hechas += 1
    return hechas, perdidas
