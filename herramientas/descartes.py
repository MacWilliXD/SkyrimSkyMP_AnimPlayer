# -*- coding: utf-8 -*-
u"""Que animaciones se descartan solas, y por que.

Hay animaciones que existen en el juego pero no sirven para rol. No es que
esten rotas: es que el juego las usa EL SOLO mientras juegas, y ponerlas en una
rueda de poses no aporta nada.

Son de dos clases:

  LOS REMATES
    Las ejecuciones. El juego las lanza al matar a un enemigo, con la camara y
    el enemigo colocados. Lanzarlas a mano deja al personaje dando tajos al
    aire, y ademas son 109 de las 737: llenan la lista de ruido.

  LAS DE JUGABILIDAD
    Atacar, bloquear, golpear con el escudo, ponerse en guardia, desenvainar.
    Eso lo hace el jugador con el raton; no hace falta un menu para pegar un
    espadazo.

Se descartan, pero NO se borran: siguen en el catalogo con su nombre y su
descripcion, y el servidor puede ensenarlas con ap.mostrar() si algun dia las
quiere. Lo escrito a mano en la hoja manda sobre esto: si pones "Aceptado", se
queda aceptada.
"""
import re

MOTIVO_REMATE = (u"Ejecución: el juego la lanza solo al matar a un enemigo, "
                 u"con la cámara y el enemigo colocados. A mano queda el "
                 u"personaje dando tajos al aire")

MOTIVO_JUGABILIDAD = (u"De jugabilidad: el jugador ya la hace con los "
                      u"controles del juego, no hace falta un menú para esto")

# Eventos de jugabilidad pura. Se mira el evento, no el nombre.
JUGABILIDAD = [
    r"^attack", r"^Attack",          # atacar, en todas sus formas
    r"^bash", r"^Bash",              # golpe de escudo
    r"^block", r"^Block",            # bloquear
    r"^recoil", r"^stagger", r"^Stagger",   # trastabillar al recibir
    r"^combatStance",                # ponerse en guardia
    r"Weap(Equip|Unequip|Out|Solo)", # sacar y guardar el arma
    r"^Unequip", r"^MagicForceEquip",
    r"^bow", r"^Bow", r"[Cc]rossbow",
    r"^move", r"^turn", r"^Sprint", r"^Brake", r"^Jump", r"^Strafe",
    r"^cannedTurn", r"^NPC_Turn", r"^NPC_Bumped",
    r"^Sneak", r"^Swim", r"^MountedSwim",
    r"^shout", r"^Shout", r"^NPCshout", r"^MC_shout",
    r"^M[LR]h_Spell", r"^DualMagic", r"^SpellRelease", r"^MagicWard",
]


MOTIVO_MUEBLE = (u"Depende de un mueble: es entrar o salir de él, y sin el "
                 u"mueble delante el jugador aparece flotando")

# Muebles y sitios de trabajo. Las de SUELO no cuentan: ahi no hay nada de lo
# que entrar ni salir, el personaje se agacha donde este y se ve bien.
MUEBLE = (r"Chair|Stool|Bench|Bed|BedRoll|Coffin|Cart|Table|Counter|Lean|"
          r"Altar|Jarl|Lounge|Throne|Ledge|Furniture|Alchemy|Enchanting|"
          r"Smelter|Tanning|Oven|GrainMill|CookingPot|CookingSpit|BlackSmith|"
          r"Hammer|Pickaxe|Ladder|Mill")
SUELO = r"LayDown|LayOnFloor|SitOnKnees|Kneel|Ground|Floor"
TRANSICION = r"Enter|Exit|Mount|Dismount"


def esDeMueble(evento):
    u"""Si es la ENTRADA o la SALIDA de un mueble.

    Lo que se descarta es el transito: sentarse, levantarse, meterse en la
    cama. Lo que se hace YA sentado —beber, leer, cruzar los brazos— se queda,
    que eso es lo util: son expresiones, y para esas ya estas en la silla.
    """
    import re as _re
    if _re.search(SUELO, evento):
        return False                 # en el suelo no hay mueble que falte
    return bool(_re.search(MUEBLE, evento) and _re.search(TRANSICION, evento))


def descarte(evento, categoria):
    u"""(siDescartar, motivo). Motivo vacio si no hay que descartar."""
    if categoria == "remates":
        return True, MOTIVO_REMATE
    for patron in JUGABILIDAD:
        if re.search(patron, evento):
            return True, MOTIVO_JUGABILIDAD
    if esDeMueble(evento):
        return True, MOTIVO_MUEBLE
    return False, u""
