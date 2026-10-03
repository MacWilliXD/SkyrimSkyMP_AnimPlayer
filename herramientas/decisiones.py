# -*- coding: utf-8 -*-
u"""Lo que se ve y lo que no, decidido a mano probandolo en el juego.

POR QUE EXISTE ESTE ARCHIVO
  El resto de reglas son automaticas: descartes.py mira el nombre del evento y
  decide por familias —los remates fuera, lo que ya se hace con los controles
  fuera, lo que depende de un mueble fuera—. Eso acierta en la mayoria, pero no
  en todas, y la unica forma de saberlo es entrar al juego y mirarlas.

  Aqui va esa correccion. Lo escrito aqui MANDA sobre todo lo demas, porque
  sale de haberlas visto.

  Dos ejemplos de por que hacia falta:

    - Las de taller —ponerse a la forja, al horno, al molino— las descartaba la
      regla de muebles, porque tecnicamente lo son. Pero se ven bien y son de
      las mas utiles para rol: un herrero necesita poder ponerse a herrar.

    - Las de los presos del carro pasaban el filtro, pero sin el carro delante
      el jugador aparece flotando en el aire.

COMO SE USA
  Por NOMBRE, no por id. El nombre es lo que se ve en la rueda y es con lo que
  uno razona al probarlas; el id no lo ve nadie. Si un nombre de aqui no existe
  en el catalogo, el generador avisa en vez de callarse: un nombre mal escrito
  que no hace nada es peor que un error.

  Y vale cualquiera de los dos nombres que tiene cada animacion:

      en el mod    "Pose fija A"
      en la hoja   "Adoptar la pose fija A"

  La hoja le pone un verbo delante para que todas empiecen por accion. Como lo
  normal es decidir leyendo la hoja —que es donde se ven todas juntas con su
  estado y su nota—, aqui se aceptan las dos formas.
"""
import estilo

# Las que SE QUEDAN aunque alguna regla automatica las descarte.
ACEPTADAS = [
    # Oficios. Son muebles, si, pero se ven bien y son lo que hace falta para
    # interpretar un oficio.
    u"Ponerse a picar en la mesa",
    u"Ponerse a picar en la mesa (Solstheim)",
    u"Ponerse al horno",
    u"Ponerse en el banco de curtido",
    u"Ponerse en el molino",
    u"Ponerse en la fundición",
    u"Ponerse a cocinar en el asador",
    u"Ponerse a cocinar en la olla",
    u"Ponerse a la mesa de alquimia",
    u"Ponerse a la mesa de encantamiento",
    u"Ponerse a martillear en el banco de carpintero",
    u"Ponerse a martillear en la mesa",
    u"Ponerse a martillear en la pared",
    u"Ponerse a picar con el pico",
    u"Trabajar en la forja",
    u"Picar con el pico",
    u"Rebuscar en la mesa",
    u"Ponerse a escribir en el registro",
    u"Escribir en el registro",

    # Y estas cuatro, que tampoco molestan.
    u"Sentarse en una repisa",
    u"Ponerse en guardia",
    u"Guardar lo que lleves en las manos",
    u"Arrodillarse en el altar",
]


# Las que se ESCONDEN aunque pasen los filtros, con el motivo de cada grupo.
DESCARTADAS = [
    (u"Sin el carro delante el jugador aparece flotando en el aire", [
        u"Preso A: en el carro",
        u"Preso A: vaivén del carro",
        u"Preso B: bajarse del carro",
        u"Preso B: en el carro",
        u"Preso B: vaivén del carro",
        u"Preso C: bajarse del carro",
        u"Preso C: en el carro",
        u"Preso C: vaivén del carro",
        u"Preso D: bajarse del carro",
        u"Preso D: en el carro",
        u"Preso D: vaivén del carro",
    ]),

    (u"Es un modo de conversación del juego, no una pose: cambia cómo gesticula "
     u"el personaje mientras habla y suelta no se ve nada", [
        u"Actitud: cercana",
        u"Actitud: distante",
        u"Actitud: juguetona",
        u"Actitud: seria",
        u"Cambiar a actitud cercana",
        u"Cambiar a actitud distante",
        u"Cambiar a actitud juguetona",
        u"Cambiar a actitud seria",
        u"Cercana: desdén",
        u"Cercana: interés",
        u"Cercana: manos al aire",
        u"Cercana: sobresalto",
        u"Cercana: súplica",
        u"Distante: desdén",
        u"Distante: interés",
        u"Distante: manos al aire",
        u"Distante: sobresalto",
        u"Distante: súplica",
        u"Hablar con naturalidad",
        u"Hablar enojado",
        u"Hablar enojado mientras te mueves",
        u"Hablar gesticulando",
        u"Hablar mientras te mueves",
        u"Hablar sentado con gesto solemne",
        u"Hablar: cambiar de gesto",
    ]),

    (u"El juego la usa él solo mientras juegas; lanzada a mano no se ve nada o "
     u"se ve mal", [
        u"Asomarse por la esquina, a la derecha",
        u"Asomarse por la esquina, a la izquierda",
        u"Cambiar el peso de pierna",
        u"Caminar hacia delante",
        u"Cargar el peso a la izquierda",
        u"Esconderse a la derecha",
        u"Paseo de cámara",
        u"Pose fija A",
        u"Pose fija B",
        u"Pose fija C",
        u"Pose de espera",
        u"Salir de la incredulidad (3)",
        u"Salir de la incredulidad (4)",
        u"Subirse los pantalones",
        u"Suspirar",
        u"Suspirar (2)",
        u"Volver la mirada a la derecha",
        u"Volver la mirada a la izquierda",
    ]),

    (u"Deja al personaje tirado en el suelo y hace falta Reiniciar para "
     u"levantarlo", [
        u"Caer de rodillas",
        u"Desplomarse como un muñeco",
        u"Levantarse del suelo",
        u"Morir",
        u"Morir despacio",
        u"Morir en la cama",
        u"Morir sobre el plato",
        u"Terminar de morir despacio",
    ]),

    (u"Necesita la telaraña delante; sin ella el personaje forcejea contra el "
     u"aire", [
        u"Forcejear en la telaraña",
        u"Forcejear en la telaraña (2)",
        u"Quedar atrapado en la telaraña",
        u"Soltarse de la telaraña",
        u"Soltarse de la telaraña y girarse",
    ]),

    (u"Es un efecto de guion, no una pose: mueve o cambia al personaje y lo "
     u"deja donde no debe", [
        u"Ascender flotando",
        u"Atravesar la pared",
        u"Explosión (1ª persona)",
        u"Transformarse",
        u"Transformarse (2)",
        u"Ir en barca",
        u"Levantarse",
        u"Aparecer",
    ]),
]


def aplicar(animaciones, avisar=None):
    u"""Deja visibles las aceptadas y esconde las descartadas.

    Devuelve (cuantasSeAceptaron, cuantasSeDescartaron). Los nombres que no
    existan en el catalogo se pasan a `avisar`, si se da: callarse ante un
    nombre mal escrito deja una decision que no hace nada y nadie se entera.
    """
    porNombre = {}
    for a in animaciones:
        porNombre.setdefault(a["nombre"], []).append(a)
        # Y por el nombre que tiene en la hoja, que lleva un verbo delante.
        enLaHoja = estilo.nombreBueno(a["nombre"])
        if enLaHoja != a["nombre"]:
            porNombre.setdefault(enLaHoja, []).append(a)

    perdidos = []
    aceptadas = 0
    for nombre in ACEPTADAS:
        fichas = porNombre.get(nombre)
        if not fichas:
            perdidos.append(nombre)
            continue
        for a in fichas:
            a.pop("visible", None)        # visible es lo normal: sin campo
            a.pop("motivoDescarte", None)
            aceptadas += 1

    descartadas = 0
    for motivo, nombres in DESCARTADAS:
        for nombre in nombres:
            fichas = porNombre.get(nombre)
            if not fichas:
                perdidos.append(nombre)
                continue
            for a in fichas:
                a["visible"] = False
                a["motivoDescarte"] = motivo
                descartadas += 1

    if perdidos and avisar:
        avisar(perdidos)
    return aceptadas, descartadas
