# -*- coding: utf-8 -*-
u"""La categoria sale del NOMBRE, y una animacion puede estar en varias.

POR QUE DEL NOMBRE Y NO DEL ID
  La categoria se decidia mirando el id del evento —IdleCombatStretchingStart
  a combate, IdleLuteStart a musica— y eso falla porque el id y lo que hace la
  animacion no siempre coinciden: el editorId no coincide con el evento en 456
  de las 737. Se veia a simple vista en la rueda:

      "Golpear el suelo"   estaba en magia
      "Entregar algo (A)"  en magia y "Entregar algo (B)" en oficios
      "Tambalear (A)"      en comer y "Tambalear (B)" en magia

  El nombre esta escrito mirando la animacion. Es el mejor dato que hay.

POR QUE EN VARIAS
  Muchas no caen en un sitio solo. "Rezar en cuclillas" es magia y tambien es
  estar de rodillas; "Beber de taza sentado" es comer y es estar sentado;
  "Limpiar espada" es un oficio y es cosa de armas. Obligarlas a elegir
  escondia la animacion de la mitad de la gente que la iba a buscar.

  Asi que cada animacion tiene una categoria PRINCIPAL —la primera regla que
  encaja, la que manda para agrupar la lista— y puede tener otras cuantas
  SECUNDARIAS. En el filtro valen todas por igual.

COMO SE ORDENAN LAS REGLAS
  Gana la primera que encaja, asi que lo concreto va antes que lo general:
  "arrodillarse en el altar" tiene que mirarse antes que "arrodillarse" a
  secas, o todas las de rodillas acabarian en el mismo sitio.

  Las palabras se buscan ENTERAS, no como trozo. Esto ya mordio una vez: con
  busqueda por trozo, "Ca-minar" caia en martillo y "S-altar" en vela.
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
    # palabra suelta. Van las primeras porque son las mas especificas.
    ("oficios", [u"llevar una copa", u"entregar cuerno", u"mostrar pocion"]),
    ("emociones", [u"calentarse las manos en cuclillas",
                   u"arrodillarse de verguenza"]),
    ("batalla", [u"defenderse", u"lanzar un golpe", u"ponerse firme"]),

    # --------------------------------------------------- lo que no es una pose
    ("remates", [u"rematar", u"remate", u"golpe de gracia", u"ejecucion"]),

    # --------------------------------------------------- montado en algo
    ("montar", [u"caballo", u"montado", u"montar", u"dragon", u"carreta",
                u"carro", u"barca", u"desmontar"]),

    # --------------------------------------------------- rituales y fe
    # Antes que "arrodillarse" y que "beber", para que "arrodillarse en el
    # altar" y "arrodillarse y beber" no se vayan a descansar ni a comer.
    ("magia", [u"ritual", u"hechizo", u"conjuro", u"bendecir", u"rezar",
               u"jurar", u"espiritu", u"altar", u"meditar", u"invocar",
               u"telequinesis", u"grito", u"magia", u"maldicion",
               u"desaparecer", u"aparecer", u"flotar", u"jarra decorada",
               u"santuario"]),

    # --------------------------------------------------- leer y escribir
    ("leer", [u"leer", u"libro", u"pergamino", u"papel", u"nota", u"escribir",
              u"registro", u"pensar", u"estudiar"]),

    # --------------------------------------------------- comida y bebida
    ("comer", [u"comer", u"beber", u"bebida", u"alimentarse", u"brindar",
               u"tambalear", u"borracho", u"hidromiel", u"pan", u"sopa",
               u"cuenco", u"carne", u"copa", u"taza", u"barril",
               u"cubiertos", u"morder el cuello", u"banquete"]),

    # --------------------------------------------------- fiesta
    ("musica", [u"bailar", u"baile", u"aplaudir", u"celebrar", u"laud",
                u"flauta", u"tambor", u"tocar cuerno", u"cantar",
                u"vitorear", u"musica", u"brindis"]),

    # --------------------------------------------------- trabajo
    ("oficios", [u"martillear", u"martillo", u"picar", u"pico", u"forja",
                 u"herrar", u"horno", u"molino", u"curtir", u"fundir",
                 u"fundicion", u"arar", u"barrer", u"lena", u"cincelar",
                 u"cubeta", u"olla", u"asador", u"cocinar", u"palanca",
                 u"cerradura", u"bandeja", u"cesto", u"flores", u"piedra",
                 u"jarra", u"rellenar", u"verter",
                 u"corteza", u"barra", u"servir", u"trabajar", u"entregar",
                 u"agarrar", u"recoger", u"rebuscar", u"inspeccionar",
                 u"vaciar", u"llenar", u"cargar", u"grano", u"extractor",
                 u"alquimia", u"encantamiento", u"coser", u"pescar",
                 u"ordenar", u"limpiar", u"sembrar", u"puerta"]),

    # --------------------------------------------------- lo militar, entero
    # Pelea, guardia, prisioneros, heridos y ejecuciones. Son lo mismo visto
    # desde los dos lados, y separarlos obligaba a adivinar en cual estaba
    # "Esperar a ejecutar".
    ("batalla", [u"guardia", u"arma", u"armas", u"espada", u"escudo",
                 u"abatido", u"retroceder", u"atacar", u"ataque", u"bloquear",
                 u"desenvainar", u"envainar", u"desenfundar", u"apuntar",
                 u"arco", u"flecha", u"ballesta", u"punetazo", u"patada",
                 u"provocar", u"trastabillar", u"antorcha",
                 u"herido", u"atado", u"ataduras", u"preso", u"cautiv",
                 u"morir", u"muerto", u"agonizar", u"sangrar", u"desplomarse",
                 u"ejecutar", u"telarana", u"forcejear", u"firme"]),

    # --------------------------------------------------- estar sentado o tumbado
    ("descansar", [u"sentarse", u"sentado", u"apoyarse", u"taburete",
                   u"silla", u"banco", u"mostrador", u"baranda", u"pared",
                   u"borde", u"repisa", u"cuclillas", u"arrodillarse",
                   u"de rodillas", u"acostarse", u"dormir", u"cabezada",
                   u"cama", u"ataud", u"saco", u"tumbarse", u"desperezarse",
                   u"bostezar", u"descansar"]),

    # --------------------------------------------------- lo que es moverse
    ("moverse", [u"caminar", u"correr", u"andar", u"saltar", u"nadar",
                 u"agacharse", u"girar", u"esquivar", u"trepar", u"escalar"]),

    # --------------------------------------------------- lo que se siente
    ("emociones", [u"reirse", u"reir", u"carcajada", u"llorar", u"llanto",
                   u"avergonzarse", u"verguenza", u"rabia", u"rabiar",
                   u"patalear", u"nervioso", u"inquieto", u"miedo",
                   u"encogerse", u"quejarse", u"suspirar", u"toser",
                   u"burlarse", u"desden", u"alterado", u"sobresalto",
                   u"incredulidad", u"pena", u"asustarse"]),

    # --------------------------------------------------- tratar con alguien
    ("cortesia", [u"saludar", u"saludo", u"respeto", u"reverenciar",
                  u"reverencia", u"agradecer", u"disculparse", u"bienvenida",
                  u"asentir", u"negar", u"rendirse", u"presentar",
                  u"llamar la atencion", u"que te sigan", u"suplica"]),

    # --------------------------------------------------- expresarse y hablar
    # La ultima a proposito: es la mas general de todas, y casi cualquier cosa
    # que no sea de las de arriba es un gesto o una forma de hablar.
    ("gestos", [u"hablar", u"gesticular", u"conversacion", u"actitud",
                u"responder", u"preguntar", u"discutir", u"mostrar algo",
                u"entender", u"senalar", u"abrazar", u"aporrear",
                u"calentarse", u"cruzar", u"brazos", u"mirar", u"observar",
                u"esperar", u"golpear", u"secarse", u"mover", u"jugar",
                u"muneca", u"morder", u"estirar", u"estirarse", u"pose"]),
]


# Las claves de antes, cuando la categoria salia del id. Las que ninguna regla
# reconoce se quedan con la que tuvieran, y hay que traducirla o acaban en una
# categoria que ya no existe.
VIEJAS = {
    "combate": "batalla", "herido": "batalla", "cautiverio": "batalla",
    "dialogo": "gestos", "sentarse": "descansar", "dormir": "descansar",
    "beber": "comer", "rituales": "magia", "acarrear": "oficios",
}


def deSuNombre(nombre, porDefecto):
    u"""(principal, [las demas]) a las que pertenece este nombre.

    La principal es la primera regla que encaja: la que manda para agrupar la
    lista. Las demas valen igual para filtrar, pero no cambian donde sale.
    """
    texto = llano(nombre)
    todas = []
    for categoria, frases in REGLAS:
        if categoria in todas:
            continue
        for frase in frases:
            if (u" " + frase + u" ") in texto:
                todas.append(categoria)
                break
    if not todas:
        return VIEJAS.get(porDefecto, porDefecto), []
    return todas[0], todas[1:]


def aplicar(animaciones):
    u"""Reparte por el nombre. Devuelve cuantas cambiaron de principal."""
    cambios = []
    for a in animaciones:
        antes = a["categoria"]
        principal, otras = deSuNombre(a["nombre"], antes)
        a["categoria"] = principal
        if otras:
            a["tambien"] = otras
        elif "tambien" in a:
            del a["tambien"]
        if principal != antes:
            cambios.append((a["nombre"], antes, principal))
    return cambios


# Las categorias que se ensenan, en el orden en que salen en el panel. Primero
# las que mas se usan: lo que uno busca al abrir la rueda es un gesto o una
# tarea, no una ejecucion.
#
# Esta lista es la unica fuente: el catalogo la copia tal cual. Antes salia de
# las reglas por id, y al cambiar de criterio quedaban dos listas que decir lo
# mismo y se desincronizaban.
LISTA = [
    ("gestos",    u"Gestos y diálogo",   u"gesto expresion hablar conversar senalar mirar"),
    ("oficios",   u"Oficios y tareas",   u"trabajo taller oficio herrar recoger llevar"),
    ("comer",     u"Comer y beber",      u"comida bebida mesa taberna banquete"),
    ("batalla",   u"Batalla",            u"combate guerra arma preso herido militar guardia"),
    ("musica",    u"Música y fiesta",    u"bailar tocar celebrar aplaudir taberna"),
    ("emociones", u"Emociones",          u"reir llorar miedo rabia verguenza animo"),
    ("descansar", u"Sentarse y dormir",  u"sentarse silla cama dormir apoyarse descansar"),
    ("cortesia",  u"Saludos y cortesía", u"saludar respeto reverencia agradecer modales"),
    ("magia",     u"Magia y rituales",   u"hechizo ritual rezar altar fe"),
    ("leer",      u"Leer y escribir",    u"libro pergamino escribir estudiar"),
    ("moverse",   u"Moverse",            u"andar correr saltar nadar"),
    ("montar",    u"Montar",             u"caballo carro dragon montura"),
    ("remates",   u"Remates",            u"ejecucion rematar"),
    ("control",   u"Control",            u"parar detener cancelar"),
    ("otras",     u"Otras",              u""),
]
