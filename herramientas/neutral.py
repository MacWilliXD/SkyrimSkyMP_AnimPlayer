# -*- coding: utf-8 -*-
u"""Español neutral: que lo entienda cualquiera, juegue desde donde juegue.

El servidor es de rol y lo lee gente de muchos sitios. Un nombre que medio
servidor no entiende no sirve de nada, y hay palabras que ademas se entienden
MAL segun el pais.

La mas importante es "coger": en España es agarrar y en buena parte de
Latinoamerica es vulgar. Esa no es cuestion de gusto, hay que cambiarla.

El resto son palabras que solo se usan en un sitio —puchero, petate, esprintar—
o anglicismos que se cuelan. Se cambian por la palabra que se entiende en todas
partes.

Se aplica a los cuatro sitios donde hay texto para leer: nombre, descripcion,
nota y dependencia.
"""
import re

# ---------------------------------------------------------------------------
# A la izquierda lo que no vale, a la derecha lo que se usa. Se compara por
# palabra entera para no romper otras: "cogerse" no es "coger", y "barra" solo
# se cambia cuando es la del mostrador.
# ---------------------------------------------------------------------------
CAMBIOS = [
    # --- esta es la que de verdad importa ---------------------------------
    (u"coger", u"agarrar"),
    (u"cojo", u"agarro"),
    (u"coge", u"agarra"),
    (u"cogiendo", u"agarrando"),
    (u"cogido", u"agarrado"),
    (u"cogida", u"agarrada"),

    # --- solo se dicen en un sitio ----------------------------------------
    # OJO con el genero: puchero y cubo son masculinos, olla y cubeta
    # femeninos. Si solo se cambia la palabra queda "Llevar un olla", asi que
    # las formas con articulo van PRIMERO y se llevan el articulo con ellas.
    (u"un puchero", u"una olla"),
    (u"el puchero", u"la olla"),
    (u"del puchero", u"de la olla"),
    (u"al puchero", u"a la olla"),
    (u"los pucheros", u"las ollas"),
    (u"puchero", u"olla"),
    (u"pucheros", u"ollas"),
    (u"un cubo", u"una cubeta"),
    (u"el cubo", u"la cubeta"),
    (u"del cubo", u"de la cubeta"),
    (u"al cubo", u"a la cubeta"),
    (u"los cubos", u"las cubetas"),
    (u"petate", u"saco de dormir"),
    (u"petates", u"sacos de dormir"),
    (u"esprintar", u"correr a toda velocidad"),
    (u"esprintando", u"corriendo a toda velocidad"),
    (u"enfadado", u"enojado"),
    (u"enfadada", u"enojada"),
    (u"enfadarse", u"enojarse"),
    (u"cubo", u"cubeta"),
    (u"cubos", u"cubetas"),
    (u"hachazo", u"golpe de hacha"),
    (u"aspa", u"cruz"),
    (u"grifo", u"llave del agua"),
    (u"zurdo", u"izquierdo"),

    # --- modismos que solo se usan en Espana -------------------------------
    (u"hacer eses", u"tambalearse"),
    (u"encajar un golpe", u"recibir un golpe"),
    (u"encajar", u"recibir"),
    (u"centrico", u"al centro"),
    (u"céntrico", u"al centro"),

    # --- la barra del bar, que no es una barra de metal --------------------
    (u"la barra", u"el mostrador"),
    (u"una barra", u"un mostrador"),
]


def _mismaCaja(original, nueva):
    u"""Deja la nueva palabra con la caja de la vieja."""
    if original[:1].isupper():
        return nueva[:1].upper() + nueva[1:]
    return nueva


def neutral(texto):
    u"""El texto con las palabras cambiadas por las neutrales."""
    if not texto:
        return texto
    fuera = texto
    for viejo, nuevo in CAMBIOS:
        # Palabra entera, y respetando mayuscula inicial.
        def _cambia(m):
            return _mismaCaja(m.group(0), nuevo)
        fuera = re.sub(r"(?<![0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ])" + re.escape(viejo) +
                       r"(?![0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ])",
                       _cambia, fuera, flags=re.IGNORECASE)
    return fuera
