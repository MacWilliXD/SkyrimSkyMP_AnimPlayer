# -*- coding: utf-8 -*-
u"""A que icono le toca cada animacion.

Por que no vale la categoria
----------------------------
Doce iconos, uno por categoria, serian los menos posibles pero no dirian gran
cosa: sentarse en una silla y meterse en una cama caerian en el mismo dibujo, y
un mandoble, un escudo y un hechizo tambien. El icono tiene que hablar de la
ACCION, asi que se mira animacion por animacion.

Como se decide
--------------
Una lista de reglas en orden, y gana la primera que encaje. Cada regla lleva
palabras del nombre en espanol y trozos del nombre del evento, que es el que no
miente: los nombres se repiten o se quedan cortos, pero "pa_KillMoveRH2HDecap"
solo puede ser un remate.

Lo que no encaje en ninguna regla se queda con el icono de su categoria, que es
la red de seguridad: ninguna animacion se queda sin icono.

POR PALABRAS ENTERAS, NO POR SUBCADENAS
---------------------------------------
Esto ya se aprendio en el buscador, donde "laud" encontraba "Aplaudir". La
primera version de este archivo buscaba subcadenas y salio exactamente el mismo
desastre:

    "Ca-minar"      -> martillo   (por "minar")
    "S-altar"       -> vela       (por "altar")
    "Dia-log-ue"    -> lena       (por "log")
    "Dev-orar"      -> rodilla    (por "orar")
    "Re-cargar"     -> caja       (por "cargar")

Asi que el nombre se parte en palabras y el evento en trozos de camelCase, y se
comparan palabras COMPLETAS. Lo que se quiera pillar por raiz se escribe con su
final, "sentad" -> ("sentado", "sentada"), a mano y a la vista.

El orden importa
----------------
Las reglas mas concretas van primero. "Remate con un arma de dos manos" tiene
que caer en el remate y no en el mandoble, y para eso el remate va antes.
"""
import re

# ---------------------------------------------------------------------------
# El icono de respaldo de cada categoria. Si ninguna regla encaja, este.
# ---------------------------------------------------------------------------
POR_CATEGORIA = {
    'combate':  'espada',
    'gestos':   'mano',
    'oficios':  'martillo',
    'magia':    'chispa',
    'dialogo':  'bocadillo',
    'herido':   'cruz',
    'comer':    'cubiertos',
    'sentarse': 'silla',
    'musica':   'nota',
    'leer':     'libro',
    'dormir':   'cama',
    'control':  'mandos',
}

# ---------------------------------------------------------------------------
# Las reglas, en orden: (icono, palabras del nombre, trozos del evento).
# Todo en minusculas y sin acentos; la comparacion es por palabra COMPLETA.
# ---------------------------------------------------------------------------
REGLAS = [
    # --- el arma manda, incluso en los remates ------------------------------
    # Van delante de la calavera a proposito. La unica parte del juego que
    # distingue una mano de dos manos son los remates, asi que si aqui ganara
    # el remate no habria dos espadas que ensenar.
    ('mandoble',  ['dos manos', 'pesada', 'pesado', 'mandoble'],
                  ['2hm', '2hw', 'twohand', 'greatsword']),
    ('espada',    ['una mano'], ['1hm', '1hs']),

    # --- lo mas concreto primero -------------------------------------------
    ('calavera',  ['remate', 'remates', 'decapitar', 'morir', 'muerte',
                   'cadaver', 'agonizar', 'expirar'],
                  ['killmove', 'decap', 'death', 'die']),
    ('grilletes', ['preso', 'presos', 'maniatado', 'maniatada', 'ataduras',
                   'forcejear', 'atado', 'atada', 'esposas'],
                  ['prisoner', 'bound', 'tied', 'shackle']),
    ('carro',     ['carro', 'pescante', 'carreta'],
                  ['cart']),
    ('telarana',  ['telarana'], ['web']),

    # --- armas y combate ----------------------------------------------------
    ('escudo',    ['escudo', 'bloquear', 'bloqueo', 'parada'],
                  ['shield', 'shd', 'block', 'bash']),
    # No hay icono de arma pesada: en el juego base TODA animacion con "pesada"
    # o "dos manos" en el nombre es un remate, y esos ya llevan calavera. Se
    # comprobo sobre las 611: cero casos fuera de los remates.
    ('arco',      ['arco', 'flecha', 'flechas', 'ballesta'],
                  ['bow', 'arrow', 'crossbow']),
    ('puno',      ['punetazo', 'punetazos', 'punos'],
                  ['h2h']),
    ('chispa',    ['hechizo', 'hechizos', 'magia', 'conjurar', 'invocar'],
                  ['spell', 'magic', 'cast', 'shout']),
    ('agachar',   ['agacharse', 'sigilo'], ['sneak']),
    ('espada',    ['arma', 'armas', 'atacar', 'ataque', 'espada', 'daga',
                   'dagas', 'envainar', 'desenvainar', 'guardia'],
                  ['attack', 'weap', '1hm', 'sword', 'dagger', 'combat']),

    # --- estados del cuerpo -------------------------------------------------
    ('cama',      ['cama', 'petate', 'ataud', 'acostarse', 'tumbarse',
                   'dormir', 'cabezadas', 'yacer', 'durmiendo'],
                  ['bed', 'coffin', 'sleep', 'laydown', 'bedroll']),
    ('silla',     ['silla', 'taburete', 'banco', 'sentarse', 'sentado',
                   'sentada', 'repantigarse', 'trono', 'levantarse'],
                  ['chair', 'stool', 'bench', 'sit', 'furniture']),
    ('apoyarse',  ['apoyarse', 'baranda', 'recostarse'],
                  ['lean']),
    ('rodilla',   ['arrodillarse', 'rodillas', 'rezar', 'orar', 'plegaria'],
                  ['kneel', 'pray']),

    # --- comer y beber ------------------------------------------------------
    # La bebida tiene icono propio. Se le suman las de borrachera y las
    # bandejas de bebidas, que son bebida y no comida: sin ellas el grupo se
    # quedaba en nueve, uno por debajo del minimo.
    ('copa',      ['beber', 'bebidas', 'brindar', 'jarra', 'jarras', 'copa',
                   'trago', 'hidromiel', 'alimentarse', 'eses', 'borracho',
                   'ebrio'],
                  ['drink', 'mug', 'toast']),
    ('puchero',   ['puchero', 'olla', 'guiso', 'cocinar', 'servir',
                   'servirse', 'barril'],
                  ['pot', 'cook', 'stir', 'serve']),
    ('cubiertos', ['comer', 'carne', 'sopa', 'cena', 'banquete', 'masticar',
                   'devorar', 'comida'],
                  ['eat', 'soup', 'food']),

    # --- leer y escribir ----------------------------------------------------
    ('pergamino', ['pergamino', 'nota', 'carta', 'notas'],
                  ['scroll']),
    ('libro',     ['libro', 'leer', 'pagina', 'paginas', 'estudiar',
                   'consultar', 'registro', 'traduccion'],
                  ['read', 'book', 'ledger']),
    ('pluma',     ['escribir', 'anotar', 'firmar'],
                  ['write', 'quill']),

    # --- musica y fiesta ----------------------------------------------------
    ('palmas',    ['aplaudir', 'vitorear', 'palmas', 'ovacion'],
                  ['clap', 'cheer', 'applaud']),
    ('nota',      ['tocar', 'laud', 'flauta', 'tambor', 'cuerno', 'cantar',
                   'baile', 'bailar'],
                  ['lute', 'flute', 'drum', 'horn', 'sing', 'dance']),

    # --- magia ceremonial ---------------------------------------------------
    ('vela',      ['ritual', 'ceremonia', 'solemne', 'altar', 'gremio',
                   'ascender', 'iniciacion', 'bendecir'],
                  ['ritual', 'ceremony', 'initiate']),

    # --- oficios ------------------------------------------------------------
    ('caja',      ['recoger', 'llevar', 'cargar', 'cesto', 'coger', 'cargado'],
                  ['pickup', 'carry', 'offsetcarry']),
    ('lena',      ['lena', 'talar', 'hacha', 'serrar', 'madera', 'tronco'],
                  ['woodchop', 'chopwood', 'log']),
    ('palanca',   ['accionar', 'palanca', 'manivela', 'polea'],
                  ['lever', 'crank', 'pulley']),
    ('martillo',  ['cincelar', 'forjar', 'martillo', 'yunque', 'minar',
                   'picar', 'muela', 'afilar', 'grabar'],
                  ['chisel', 'forge', 'hammer', 'mine', 'pickaxe', 'anvil']),

    # --- gestos y dialogo ---------------------------------------------------
    ('fuego',     ['calentarse', 'hoguera', 'fogata'], ['warmhands']),
    ('senalar',   ['senalar', 'indicar'], ['point']),
    ('bocadillo', ['hablar', 'actitud', 'conversar', 'dialogo', 'discurso',
                   'susurrar', 'cuchichear', 'charlar'],
                  ['dialogue', 'talk', 'speech']),
    ('mano',      ['saludar', 'saludo', 'despedirse', 'gesto', 'encogerse',
                   'burlarse', 'abrazar'],
                  ['wave', 'salute', 'shrug', 'taunt', 'hug']),
]

# ---------------------------------------------------------------------------
# MINIMO DIEZ ANIMACIONES POR ICONO
#
# Un dibujo que solo etiqueta tres cosas no ayuda a nadie: no se aprende, no se
# reconoce, y solo anade ruido a la rueda. Asi que los grupos que no llegan a
# diez se funden en el que mas se les parece.
#
# La regla que los detecta se queda arriba tal cual —sigue diciendo la verdad
# sobre esa animacion— y aqui solo se dice con que dibujo acaba. Si algun dia
# entran animaciones de un mod que engorden un grupo, deshacer la fusion es
# quitar su linea.
#
# A la derecha, cuantas traia cada uno.
# ---------------------------------------------------------------------------
FUSIONES = {
    'palmas':    'mano',        #  8  aplaudir es un gesto de manos
    'rodilla':   'vela',        #  7  arrodillarse y rezar, con lo ceremonial
    'pergamino': 'libro',       #  7  un pergamino es algo que se lee
    'puchero':   'cubiertos',   #  5  cocinar acaba en comida
    'carro':     'caja',        #  5  el carro es llevar carga
    'apoyarse':  'silla',       #  5  ya comparten categoria, "sentarse y apoyarse"
    'arco':      'espada',      #  5  sigue siendo atacar con un arma
    'puno':      'espada',      #  5  y a punetazos, tambien
    'fuego':     'vela',        #  4  calentarse las manos, junto a la llama
    'senalar':   'mano',        #  3  senalar es la mano
    'telarana':  'cruz',        #  3  quedar atrapado va con lo de herido
    'mandos':    'mano',        #  3  soltar lo que llevas en las manos
    'agachar':   'espada',      #  2  agacharse es sigilo, y el sigilo es combate
    'lena':      'martillo',    #  2  cortar lena es un oficio
    'palanca':   'martillo',    #  1  accionar algo, tambien
    'pluma':     'libro',       #  1  escribir va con leer
}

MINIMO = 10

# Los iconos que de verdad se usan salen de aqui: es lo que hay que dibujar.
TODOS = sorted(set(
    [FUSIONES.get(i, i) for i, _n, _e in REGLAS] +
    [FUSIONES.get(i, i) for i in POR_CATEGORIA.values()]))


def _sinAcentos(t):
    for a, b in zip(u'áéíóúüñ',
                    u'aeiouun'):
        t = t.replace(a, b)
    return t


def palabrasDelNombre(nombre):
    """El nombre partido en palabras, en minusculas y sin acentos."""
    return set(re.findall(r'[a-z]+', _sinAcentos(nombre.lower())))


def trozosDelEvento(evento):
    """El evento partido por camelCase y por _, en minusculas.

    "pa_KillMoveRH2HDecap" -> {pa, kill, move, rh, h, decap}
    Asi "Dialogue" no contiene la palabra "log", que era el problema.
    """
    piezas = re.findall(r'[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|[0-9]+[A-Za-z]*',
                        evento)
    return set(p.lower() for p in piezas)


def icono(nombre, evento, categoria):
    """El icono que le toca. Nunca vacio: la categoria es el respaldo."""
    cual, _regla = conRegla(nombre, evento, categoria)
    return cual


def conRegla(nombre, evento, categoria):
    """Como icono(), pero dice tambien por que: (icono, motivo)."""
    pal = palabrasDelNombre(nombre)
    frase = _sinAcentos(nombre.lower())
    tro = trozosDelEvento(evento)
    for cual, delNombre, delEvento in REGLAS:
        for p in delNombre:
            # Con espacio es una FRASE y se busca en el nombre entero. Hace
            # falta para "dos manos": por palabras sueltas, "manos" cazaria
            # "Calentarse las manos".
            if (p in frase) if ' ' in p else (p in pal):
                return _fundido(cual), 'nombre:' + p + _de(cual)
        for t in delEvento:
            if t in tro:
                return _fundido(cual), 'evento:' + t + _de(cual)
    suyo = POR_CATEGORIA.get(categoria, 'mano')
    return _fundido(suyo), 'categoria:' + categoria + _de(suyo)


def _fundido(cual):
    return FUSIONES.get(cual, cual)


def _de(cual):
    """Para el informe: de que grupo venia, si acabo fundido en otro."""
    return ' (via ' + cual + ')' if cual in FUSIONES else ''
