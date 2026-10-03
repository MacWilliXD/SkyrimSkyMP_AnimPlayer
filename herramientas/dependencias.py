# -*- coding: utf-8 -*-
u"""Que necesita el jugador para poder ejecutar cada animacion.

No todas las poses se pueden lanzar desde cero. Muchas se montan sobre algo que
ya tiene que estar: un arma concreta en la mano, estar sentado, estar subido al
carro, o estar ya dentro de otra animacion que esta la termina.

La frase dice el ESTADO o el EQUIPO que hace falta, y lo dice concreto:

    "Necesita un arma de una mano desenvainada"   y no "ir armado"
    "Estar subido en el carro"                    y no "ir en carro"

Se deduce del nombre del evento, que es lo que no miente, y las reglas van en
orden: gana la primera que encaja, asi que lo mas concreto va primero. El tipo
de arma antes que "arma" a secas, y salir de algo antes que estar en ello.
"""
import re

# (frase, patron sobre el evento). Lo concreto, primero.
REGLAS = [
    # --- salir de algo: hace falta estar ya dentro -------------------------
    (u"Estar subido en el carro", r"Cart.*(Exit|Dismount)|Exit.*Cart"),
    (u"Estar montado en un caballo", r"Horse.*(Exit|Dismount)|Dismount.*Horse"),
    (u"Estar montado en un dragón", r"Dragon.*(Exit|Dismount)|Ground_Dismount"),
    (u"Estar sentado en una silla", r"Chair.*Exit|Stool.*Exit|Bench.*Exit"),
    (u"Estar acostado en la cama", r"Bed.*Exit|BedRoll.*Exit"),
    (u"Estar dentro del ataúd", r"Coffin.*Exit"),
    (u"Estar en el mueble o la mesa de trabajo",
     r"Furniture.*Exit|Table.*Exit|Counter.*Exit|Lean.*Exit"),
    (u"Estar ya haciendo esa animación", r"Exit(Instant|Slow)?$|GetUp|Stop$"),

    # --- armas, por tipo --------------------------------------------------
    (u"Necesita dos armas desenvainadas, una en cada mano",
     r"DualWield|DWDual|DWX|DualSlash"),
    (u"Necesita un arma de una mano desenvainada", r"1HM|1HS|OneHand"),
    (u"Necesita un arma a dos manos desenvainada", r"2HM|TwoHand"),
    (u"Necesita un arma pesada desenvainada (hacha o martillo a dos manos)",
     r"2HW"),
    (u"Necesita tener los puños libres, sin arma", r"H2H"),
    (u"Necesita un arco equipado", r"[Bb]ow(?!l)|Arrow"),
    (u"Necesita una ballesta equipada", r"[Cc]rossbow"),
    (u"Necesita un escudo equipado", r"[Ss]hield|Shd|[Bb]lock|[Bb]ash"),
    (u"Necesita una antorcha equipada", r"[Tt]orch"),
    (u"Necesita un arma desenvainada, de cualquier tipo",
     r"^attack|^Attack|CombatReady|IdleCombat|KillMove|^pa_|Weap|combatStance"),

    # --- magia ------------------------------------------------------------
    (u"Necesita un hechizo preparado en las dos manos", r"DualMagic"),
    (u"Necesita un hechizo preparado en la mano izquierda", r"^MLh_|^MLH_"),
    (u"Necesita un hechizo preparado en la mano derecha", r"^MRh_"),
    (u"Necesita un grito aprendido", r"[Ss]hout"),
    (u"Necesita un hechizo preparado en la mano",
     r"^MC_|^Magic|Spell|Ward|Telekinesis"),

    # --- muebles y sitios -------------------------------------------------
    (u"Estar sentado en una silla, banco o taburete",
     r"Chair|Stool|Bench|Jarl|Lounge|Throne|SitCross|SitLedge"),
    (u"Estar en la barra o el mostrador", r"BarCounter|Counter"),
    (u"Estar acostado en la cama o en un saco de dormir",
     r"\bBed|BedRoll|Sleep"),
    (u"Estar dentro de un ataúd", r"Coffin"),
    (u"Estar delante de la mesa de trabajo",
     r"Table|Workbench|Alchemy|Enchanting|Forge|BlackSmith|Anvil|GrainMill|"
     r"Oven|CookingPot|CookingSpit|Smelter|Tanning|Carpenter|Mill"),
    (u"Estar delante de un altar o un santuario",
     r"Altar|Blessing|Shrine|WayShrine"),
    (u"Estar subido en el carro", r"Cart"),
    (u"Estar montado en un caballo", r"Horse|Mounted"),
    (u"Estar montado en un dragón", r"Dragon(Mount|Ride|Rodeo)"),

    # --- estado del cuerpo ------------------------------------------------
    (u"Estar agachado", r"Sneak|Crouch"),
    (u"Estar maniatado o preso", r"Bound|Prisoner|Tied|Shackle"),
    (u"Estar herido o desangrándose", r"BleedOut|Bleedout|Flinch|Dying"),
    (u"Estar muerto o abatido", r"Death|Ragdoll"),
    (u"Estar dentro del agua", r"Swim"),
    (u"Estar ya en movimiento",
     r"^move|^turn|Sprint|Brake|Jump|Fall|Land|Strafe|cannedTurn|NPC_Turn"),

    # --- cosas en la mano -------------------------------------------------
    (u"Necesita llevar el objeto en las manos",
     r"Carry|PickUp|PutDown|Offset(?!Stop)"),

    # --- diálogo ----------------------------------------------------------
    (u"Estar en una conversación", r"Dialogue|Talk|Speech"),
]


def dependencia(evento, ficha=None):
    u"""La frase de lo que hace falta, o cadena vacia si no necesita nada."""
    if ficha and ficha.get("sentado"):
        return u"Estar sentado en una silla, banco o taburete"

    for frase, patron in REGLAS:
        if re.search(patron, evento):
            return frase
    return u""
