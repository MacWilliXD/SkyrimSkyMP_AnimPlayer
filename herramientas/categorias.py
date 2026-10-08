# -*- coding: utf-8 -*-
u"""La categoria sale del NOMBRE, no del id.

POR QUE SE CAMBIA
  Hasta ahora la categoria se decidia mirando el id del evento
  —IdleCombatStretchingStart va a combate, IdleLuteStart a musica— y eso falla
  porque el id y lo que hace la animacion no siempre coinciden: el editorId no
  coincide con el evento en 456 de las 737. Se veia a simple vista en la rueda:

      "Golpear el suelo"   estaba en magia
      "Entregar algo (A)"  en magia y "Entregar algo (B)" en oficios
      "Tambalear (A)"      en comer y "Tambalear (B)" en magia
      "Lanzar un golpe"    en herido

  El nombre, en cambio, esta escrito mirando la animacion. Es el mejor dato
  que hay, asi que es el que manda.

COMO FUNCIONA
  Una lista ORDENADA de reglas. Gana la primera que encaja, asi que lo
  concreto va antes que lo general: "arrodillarse en el altar" tiene que
  mirarse antes que "arrodillarse" a secas, o todas las de rodillas acabarian
  en el mismo sitio.

  Las palabras se buscan ENTERAS, no como trozo. Esto ya mordio una vez: con
  busqueda por trozo, "Ca-minar" caia en martillo y "S-altar" en vela. Una
  palabra de la regla encaja con una palabra del nombre o no encaja.

  Lo que no encaja con ninguna regla se queda con la categoria que tuviera,
  que es la del id. Mejor eso que inventarse una.
"""
import re
import unicodedata


def llano(t):
    u"""Minusculas, sin acentos y partido en palabras."""
    t = unicodedata.normalize("NFD", t or u"")
    t = u"".join(c for c in t if unicodedata.category(c) != "Mn")
    return u" " + re.sub(u"[^a-z0-9]+", u" ", t.lower()).strip() + u" "


# Cada regla es (categoria, [frases]). Una frase encaja si aparece entera
# dentro del nombre, con sus palabras completas: "pico" no encaja con "picor".
#
# EL ORDEN IMPORTA. De lo mas concreto a lo mas general.
REGLAS = [
    # --------------------------------------------------- las excepciones
    # Frases concretas que una regla de abajo se llevaria a otro sitio por una
    # palabra suelta. Van las primeras porque son las mas especificas: es el
    # mismo criterio que el resto de la lista, llevado al extremo.
    ("oficios", [u"llevar una copa", u"entregar cuerno", u"mostrar pocion"]),
    ("gestos", [u"calentarse las manos en cuclillas",
                u"arrodillarse de verguenza"]),
    ("combate", [u"defenderse", u"lanzar un golpe"]),

    # --------------------------------------------------- lo que no es una pose
    ("remates", [u"rematar", u"remate", u"golpe de gracia", u"ejecucion"]),

    # --------------------------------------------------- montado en algo
    ("montar", [u"caballo", u"montado", u"montar", u"dragon", u"carreta",
                u"carro", u"barca", u"desmontar"]),

    # --------------------------------------------------- tumbado
    ("dormir", [u"acostarse", u"dormir", u"cabezada", u"cama", u"ataud",
                u"saco", u"tumbarse", u"desperezarse", u"bostezar"]),

    # --------------------------------------------------- rituales y fe
    # Va antes que "arrodillarse" y que "beber", para que "arrodillarse en el
    # altar" y "arrodillarse y beber" no se vayan a sentarse ni a comer.
    ("magia", [u"ritual", u"hechizo", u"conjuro", u"bendecir", u"rezar",
               u"jurar", u"espiritu", u"altar", u"meditar", u"invocar",
               u"telequinesis", u"grito", u"magia", u"maldicion",
               u"desaparecer", u"aparecer", u"flotar", u"verter con jarra"]),

    # --------------------------------------------------- leer y escribir
    ("leer", [u"leer", u"libro", u"pergamino", u"papel", u"nota", u"escribir",
              u"registro", u"pensar", u"estudiar"]),

    # --------------------------------------------------- comida y bebida
    ("comer", [u"comer", u"beber", u"bebida", u"alimentarse", u"brindar",
               u"tambalear", u"borracho", u"hidromiel", u"pan",
               u"sopa", u"cuenco", u"carne", u"copa", u"taza", u"barril",
               u"cubiertos", u"morder el cuello", u"banquete"]),

    # --------------------------------------------------- fiesta
    ("musica", [u"bailar", u"baile", u"aplaudir", u"celebrar", u"laud",
                u"flauta", u"tambor", u"tocar cuerno", u"cantar", u"vitorear",
                u"musica", u"brindis"]),

    # --------------------------------------------------- trabajo
    ("oficios", [u"martillear", u"martillo", u"picar", u"pico", u"forja",
                 u"herrar", u"horno", u"molino", u"curtir", u"fundir",
                 u"fundicion", u"arar", u"barrer", u"lena", u"cincelar",
                 u"cubeta", u"olla", u"asador", u"cocinar", u"palanca",
                 u"cerradura", u"bandeja", u"cesto", u"flores", u"piedra",
                 u"corteza", u"barra", u"servir", u"trabajar", u"entregar",
                 u"agarrar", u"recoger", u"rebuscar", u"inspeccionar",
                 u"vaciar", u"llenar", u"cargar", u"grano", u"extractor",
                 u"alquimia", u"encantamiento", u"mostrar pocion", u"coser",
                 u"pescar", u"ordenar", u"limpiar", u"sembrar"]),

    # --------------------------------------------------- pelea
    ("combate", [u"guardia", u"arma", u"armas", u"espada", u"escudo",
                 u"abatido", u"retroceder", u"atacar", u"ataque", u"bloquear",
                 u"desenvainar", u"envainar", u"desenfundar", u"apuntar",
                 u"arco", u"flecha", u"ballesta", u"punetazo", u"patada",
                 u"provocar", u"trastabillar", u"antorcha"]),

    # --------------------------------------------------- preso, herido, muerto
    ("herido", [u"herido", u"atado", u"ataduras", u"preso", u"cautiv",
                u"morir", u"muerto", u"agonizar", u"sangrar", u"desplomarse",
                u"ejecutar", u"telarana", u"forcejear", u"arrodillarse atado"]),

    # --------------------------------------------------- hablar
    ("dialogo", [u"hablar", u"gesticular", u"conversacion", u"asentir",
                 u"negar", u"bienvenida", u"entender", u"actitud",
                 u"responder", u"preguntar", u"discutir", u"mostrar algo"]),

    # --------------------------------------------------- estar sentado o apoyado
    ("sentarse", [u"sentarse", u"sentado", u"apoyarse", u"taburete", u"silla",
                  u"banco", u"mostrador", u"baranda", u"pared", u"borde",
                  u"repisa", u"cuclillas", u"arrodillarse", u"de rodillas"]),

    # --------------------------------------------------- lo que es moverse
    ("moverse", [u"caminar", u"correr", u"andar", u"saltar", u"nadar",
                 u"agacharse", u"girar", u"esquivar", u"trepar", u"escalar"]),

    # --------------------------------------------------- expresarse
    # La ultima a proposito: es la mas general de todas, y casi cualquier cosa
    # que no sea de las de arriba es una expresion.
    ("gestos", [u"saludar", u"saludo", u"reirse", u"reir", u"llorar",
                u"abrazar", u"avergonzarse", u"verguenza", u"rabia",
                u"patalear", u"nervioso", u"inquieto", u"miedo", u"encogerse",
                u"rendirse", u"senalar", u"respeto", u"reverenciar",
                u"agradecer", u"disculparse", u"toser", u"quejarse",
                u"suspirar", u"estirar", u"estirarse", u"calentarse",
                u"cruzar", u"brazos", u"mirar", u"observar", u"esperar",
                u"golpear", u"aporrear", u"firme", u"secarse", u"mover",
                u"jugar", u"munieca", u"atencion", u"burlarse", u"desden",
                u"morder"]),
]


def deSuNombre(nombre, porDefecto):
    u"""La categoria que le toca por su nombre, o la que tuviera."""
    texto = llano(nombre)
    for categoria, frases in REGLAS:
        for frase in frases:
            if (u" " + frase + u" ") in texto:
                return categoria
    return porDefecto


def aplicar(animaciones):
    u"""Recategoriza por el nombre. Devuelve la lista de cambios."""
    cambios = []
    for a in animaciones:
        antes = a["categoria"]
        ahora = deSuNombre(a["nombre"], antes)
        if ahora != antes:
            a["categoria"] = ahora
            cambios.append((a["nombre"], antes, ahora))
    return cambios
