# -*- coding: utf-8 -*-
u"""Un solo estilo para los nombres y las descripciones.

LA REGLA
  Nombre      empieza por VERBO EN INFINITIVO:  "Recostarse en la cama"
  Descripcion empieza por VERBO EN INFINITIVO:  "Recostarse boca arriba y..."

  Asi la lista se lee como una lista de acciones y no como una mezcla de
  sustantivos ("Nerviosismo"), participios ("Herido") y ordenes ("Sacar arma").

SINONIMOS
  Lo mismo se dice siempre igual. Acostarse y recostarse son la misma accion, y
  tener dos palabras para una sola cosa hace que buscar falle: escribes
  "recostarse" y no sale lo que esta como "acostarse". Se elige una y punto.

LO QUE NO SE PUEDE AUTOMATIZAR
  Pasar un sustantivo a infinitivo de verdad —"Nerviosismo" a "Ponerse
  nervioso"— es escribir, no transformar. Lo que hay aqui son los casos que se
  repiten; el resto se arregla a mano en la hoja de revision, que para eso
  esta.
"""
import re

# ---------------------------------------------------------------------------
# Sinonimos: a la izquierda lo que se escribe, a la derecha lo que se usa.
# Se compara por palabra entera, igual que en el buscador: aqui tambien
# "acostarse" dentro de otra palabra no deberia contar.
# ---------------------------------------------------------------------------
SINONIMOS = {
    # Solo lo que de verdad es la MISMA accion. La primera version metia aqui
    # cosas que solo se parecen, y se cargaba el significado:
    #
    #   "Tomar sopa"          -> "Coger sopa"      (tomar ahi es comer)
    #   "Aporrear una puerta" -> "Pegar una puerta"
    #   "Desenvainar"         -> "Sacar"           (sacar, que?)
    #
    # Asi que se quedan los sinonimos limpios y se dejan en paz los verbos que
    # dicen algo que ningun otro dice.
    u"recostarse": u"acostarse",
    u"recostar": u"acostar",
    u"tumbarse": u"acostarse",
    u"echarse": u"acostarse",
    u"incorporarse": u"levantarse",
    u"alzarse": u"levantarse",
    u"erguirse": u"levantarse",
    u"charlar": u"hablar",
    u"conversar": u"hablar",
    u"platicar": u"hablar",
    u"beberse": u"beber",
    u"comerse": u"comer",
    u"brincar": u"saltar",
    u"contemplar": u"mirar",
    u"ojear": u"mirar",
    u"portar": u"llevar",
    # Y en el otro sentido: el termino del juego manda sobre el generico.
    u"sacar el arma": u"desenvainar",
    u"guardar el arma": u"envainar",
    u"enfundar": u"envainar",
}

# ---------------------------------------------------------------------------
# Sustantivos y participios que salen del traductor automatico, con su verbo.
# Son los que se repiten; no pretende ser una lista completa.
# ---------------------------------------------------------------------------
A_INFINITIVO = {
    u"nerviosismo": u"ponerse nervioso",
    u"incredulidad": u"mostrar incredulidad",
    u"saludo": u"saludar",
    u"saludo militar": u"saludar al modo militar",
    u"remate": u"rematar",
    u"ataque": u"atacar",
    u"ataque potente": u"atacar con fuerza",
    u"herido": u"quedar herido",
    u"muerte": u"morir",
    u"baile": u"bailar",
    u"pose": u"adoptar la pose",   # "Posar fija A" no es castellano
    u"postura": u"adoptar la postura",
    u"actitud": u"adoptar la actitud",
    u"gesto": u"hacer un gesto",
    u"ceremonia": u"celebrar la ceremonia",
    u"ritual": u"celebrar el ritual",
    u"reverencia": u"hacer una reverencia",
    u"bostezo": u"bostezar",
    u"sobresalto": u"sobresaltarse",
    u"suplica": u"suplicar",
    u"desden": u"mostrar desden",
    u"burla": u"burlarse",
    u"risa": u"reirse",
    u"llanto": u"llorar",
    u"aplauso": u"aplaudir",
}


def _palabras(texto):
    return re.findall(r"[0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+|[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+",
                      texto)


def unificarSinonimos(texto):
    u"""Cambia cada sinonimo por la palabra elegida, respetando mayusculas."""
    fuera = []
    for trozo in _palabras(texto):
        bajo = trozo.lower()
        if bajo in SINONIMOS:
            nueva = SINONIMOS[bajo]
            if trozo[:1].isupper():
                nueva = nueva[:1].upper() + nueva[1:]
            fuera.append(nueva)
        else:
            fuera.append(trozo)
    return "".join(fuera)


def aInfinitivo(nombre):
    u"""Pasa a infinitivo los arranques que se sabe cambiar."""
    bajo = nombre.lower().strip()

    # Primero la frase entera, que "saludo militar" es mas concreto que "saludo".
    for clave in sorted(A_INFINITIVO, key=len, reverse=True):
        if bajo == clave:
            v = A_INFINITIVO[clave]
            return v[:1].upper() + v[1:]
        if bajo.startswith(clave + " ") or bajo.startswith(clave + ","):
            v = A_INFINITIVO[clave]
            resto = nombre[len(clave):]
            return v[:1].upper() + v[1:] + resto

    return nombre


# ---------------------------------------------------------------------------
# El traductor automatico deja el verbo AL FINAL, porque el editor ID lo lleva
# ahi: IdleAlchemyEnter -> "alquimia entrar". En espanol el verbo va delante, y
# ademas queremos infinitivo, asi que se da la vuelta.
#
# No sale castellano perfecto —"Empezar la alquimia" habria que escribirlo— pero
# si queda el verbo delante, en infinitivo y siempre el mismo para la misma
# accion, que es lo que hace que la lista se lea y se pueda buscar.
# ---------------------------------------------------------------------------
COLA_A_VERBO = [
    (u"entrar", u"Empezar"),
    (u"empezar", u"Empezar"),
    (u"salir", u"Dejar"),
    (u"parar", u"Dejar"),
    (u"terminar", u"Terminar"),
    (u"bucle", u""),        # el bucle es la pose en si: se quita y ya
    (u"pose", u""),
]


def verboDelante(nombre):
    u"""Mueve el verbo del final al principio: "alquimia entrar" -> "Empezar
    alquimia"."""
    bajo = nombre.lower().rstrip(" .")
    for cola, verbo in COLA_A_VERBO:
        if bajo.endswith(" " + cola):
            resto = nombre[:len(nombre) - len(cola)].strip(" ,.")
            if not resto:
                continue
            resto = resto[:1].lower() + resto[1:]
            junto = (verbo + " " + resto).strip()
            return junto[:1].upper() + junto[1:]
    return nombre


def nombreBueno(nombre):
    u"""El nombre ya normalizado: infinitivo donde se sabe, y sin sinonimos."""
    n = unificarSinonimos(nombre.strip())
    n = verboDelante(n)
    n = aInfinitivo(n)
    return n[:1].upper() + n[1:] if n else n


# ---------------------------------------------------------------------------
# Descripciones que se pueden deducir. No sustituyen a escribirlas mirando la
# animacion —eso lo hace quien revisa— pero una frase util es mejor que un
# hueco, sobre todo en las descartadas, que son cientos y nadie va a repasar
# una por una.
# ---------------------------------------------------------------------------
PLANTILLAS = {
    "remates": u"%s. Es una ejecución: el juego la lanza al rematar a un "
               u"enemigo, con la cámara y el enemigo ya colocados.",
    "combate": u"%s. Forma parte del combate normal del juego.",
    "moverse": u"%s. Es parte del movimiento normal del personaje.",
    "magia":   u"%s. Forma parte de lanzar hechizos.",
}


def descripcionDeducida(nombre, categoria, dependencia=u""):
    u"""Una descripcion razonable a partir de lo que ya se sabe de la ficha."""
    base = (nombre or u"").rstrip(u" .")
    if not base:
        return u""
    plantilla = PLANTILLAS.get(categoria)
    if plantilla:
        return plantilla % base
    if dependencia:
        return u"%s. Necesita: %s." % (base, dependencia[:1].lower() + dependencia[1:])
    return base + u"."


def descripcionBuena(texto, nombre=""):
    u"""La descripcion, empezando por verbo y sin sinonimos.

    Si no empieza por verbo no se inventa nada: se devuelve tal cual, limpia de
    sinonimos. Escribir una descripcion de cero no es trabajo de un script.
    """
    d = unificarSinonimos((texto or "").strip())
    if not d:
        return u""
    # Arranques tipicos del traductor que no son verbo.
    d = re.sub(u"^(Animación|Animacion) (de|para|que|del|al) ", u"", d)
    d = re.sub(u"^(El|La|Los|Las|Un|Una) personaje ", u"", d)
    return d[:1].upper() + d[1:]
