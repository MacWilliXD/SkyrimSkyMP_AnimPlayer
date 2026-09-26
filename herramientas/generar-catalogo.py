# -*- coding: utf-8 -*-
"""Genera catalogo/vanilla.json a partir del Skyrim que haya instalado.

Que hace y por que
------------------
Una animacion se reproduce mandando un "evento de animacion" al grafo de Havok
del personaje: Debug.sendAnimationEvent(actor, "IdleWave"). Ese nombre tiene
que existir de verdad; si no existe no pasa nada, ni error ni animacion. Por eso
la lista NO se escribe a mano: se saca del juego instalado.

De donde sale la lista
    De los registros IDLE de Skyrim.esm y los DLC. Cada uno lleva:
        EDID  nombre de editor, legible       -> la etiqueta que se muestra
        ENAM  nombre del evento               -> lo que se manda al juego
        DNAM  ruta del fichero de animacion   -> de que criatura es
    Nos quedamos con los que tienen la ruta bajo "actors/character", que son los
    que puede reproducir una persona. Los de dragon, lobo, arana y demas no
    sirven para un jugador humanoide: el evento existe, pero su esqueleto no.

Que se marca
    Lo que SkyMP nunca va a sincronizar (el detalle esta en
    docs/sincronizacion.md): los eventos con "equip" en el nombre, los que SkyMP
    tiene en su lista de ignorados, y los de agacharse. No se borran, se marcan
    con sincroniza=false y su motivo, para que la interfaz pueda avisar de que
    eso solo lo vera quien lo lanza.

Uso
    python generar-catalogo.py "C:/ruta/a/Skyrim Special Edition/Data"
    python generar-catalogo.py        (usa el Skyrim de Steam por defecto)

Y despues, para meter el catalogo dentro del plugin:
    python generar-plugin.py
"""
import json
import io
import os
import re
import sys
import collections

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
import idles
import traducciones

RUTA_POR_DEFECTO = ("C:/Program Files (x86)/Steam/steamapps/common/"
                    "Skyrim Special Edition/Data")

# Los plugins de los que se saca la lista, en orden de carga.
PLUGINS = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm",
           "Dragonborn.esm"]

# ---------------------------------------------------------------------------
# Lo que SkyMP no sincroniza. No se descarta: se marca, para que se vea el
# motivo en la interfaz en vez de quedar como un boton que parece roto.
# ---------------------------------------------------------------------------
MOTIVO_EQUIP = "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"
NO_SINCRONIZA = {
    "moveStart": "esta en la lista de eventos que SkyMP ignora",
    "moveStop": "esta en la lista de eventos que SkyMP ignora",
    "turnStop": "esta en la lista de eventos que SkyMP ignora",
    "SneakStart": "SkyMP lo usa para su propio sincronizado de agacharse",
    "SneakStop": "SkyMP lo usa para su propio sincronizado de agacharse",
    "DrinkPotion_": "SkyMP no manda los eventos que empiezan por DrinkPotion_",
}

# ---------------------------------------------------------------------------
# Categorias. El orden importa: gana la primera regla que encaje, asi que las
# mas especificas van antes. Combate va primera a proposito: barre todo el
# ruido interno de pelea, que es la mitad de la lista y no son poses.
#   clave, nombre visible, palabras de busqueda en espanol, patrones
# ---------------------------------------------------------------------------
CATEGORIAS = [
    ("combate", "Combate", "pelear luchar atacar espada arco escudo grito", [
        r"^attack", r"^Attack", r"^bash", r"^Bash", r"^block", r"^bow",
        r"^crossbow", r"^recoil", r"^reload", r"^stagger", r"^Stagger",
        r"^shout", r"^Shout", r"^ward", r"^wardAbsorb", r"^Ragdoll$",
        r"^MC_", r"^MLh_", r"^MLH_", r"^MRh_", r"^Magic", r"^Shd",
        r"^Weap", r"^torch", r"^swim", r"^Swim", r"^Ritual[Ss]pell",
        r"^idleRitualSpell", r"CombatReady", r"^IdleCombat", r"KillMove",
        r"^pa_", r"^bleedOut", r"^Bleedout", r"^Flinch", r"^Unequip",
        r"^Jump", r"^Sprint", r"^Brake", r"^NPCshout", r"^MT_", r"^Sneak",
        r"^move", r"^turn", r"^CannedTurn", r"^NPC_", r"^Mounted",
        r"^BatSprint", r"^StaffBash", r"^Ambush", r"^Horse", r"^Dragon",
        r"^Ground_Dismount", r"^Lever_", r"^ExecutionNextClip",
    ]),
    ("sentarse", "Sentarse y apoyarse",
     "sentarse silla taburete banco mesa barra apoyarse trono", [
         r"[Cc]hair", r"[Ss]tool", r"^IdleTable", r"^idleTable", r"[Cc]ounter",
         r"^IdleJarl", r"^IdleLounge", r"[Rr]ailLean", r"[Ww]allLean",
         r"^IdleAltarEnter", r"^IdleWallSoldier", r"^IdleHideR",
         r"^IdleWallCornerPeek",
     ]),
    ("dormir", "Dormir y tumbarse",
     "dormir cama tumbarse acostarse ataud desmayarse suelo", [
         r"[Bb]ed", r"[Cc]offin", r"PassOut", r"SleepNod", r"LayOnFloor",
         r"^IdleWeb",
     ]),
    ("oficios", "Oficios y tareas",
     "trabajar herrero minar talar barrer granja escribir recoger", [
         r"[Bb]lackSmith", r"WoodChop", r"woodputdown", r"^IdleWoodPickUp",
         r"[Pp]ickaxe", r"[Cc]hisel", r"Sharpening", r"[Ss]weeping", r"^IdleHoe",
         r"FeedChicken", r"WriteLedger", r"[Ww]riteTable", r"^IdleChairWrite",
         r"LightSconce", r"CarryPot", r"CarryBasket", r"FlowerBasket",
         r"^IdleBarCounterWipe", r"WaterScoop", r"^IdleStonePickUp",
         r"^IdleStonePutDown", r"^IdleSearch", r"^IdleLockPick",
         r"^IdlePullChain", r"^IdleActivatePickUp", r"^IdlePickup", r"^IdleTake",
         r"^IdleGive", r"^IdleSell", r"^IdleExamine", r"^IdleDwemerExtractor",
         r"^IdleCartDriver", r"^IdleCartTravel", r"^IdleActivateCoffinPuzzle",
     ]),
    ("comer", "Comer y beber",
     "comer beber cenar hidromiel sopa brindar calentarse manos fuego", [
         r"[Ee]ating", r"[Dd]rink", r"^IdleEatSoup", r"[Mm]eadBarrel",
         r"WarmHands", r"WarmArms", r"^Drunk", r"^IdleMQ201",
         r"^IdleOffsetCarryPotServe",
     ]),
    ("musica", "Música y fiesta",
     "musica bailar tocar laud flauta tambor aplaudir animar cuerno vitorear", [
         r"^IdleLuteStart", r"^IdleDrumStart", r"^IdleFluteStart", r"[Dd]ance",
         r"[Aa]pplaud", r"^IdleCivilWarCheer", r"^Spectator", r"BlowHorn",
         r"^IdleCicero",
     ]),
    ("magia", "Magia y rituales",
     "rezar orar ritual altar bendicion meditar pergamino transformarse", [
         r"^IdlePray", r"BlessingKneel", r"[Rr]itual", r"^IdleMagic_",
         r"[Mm]esmerize", r"Meditate", r"ElderScroll", r"[Nn]octurnal",
         r"^IdleBoyRitual", r"^IdleCO2Ceremony", r"^IdleBloodPortal",
         r"^IdleSnowElfPrince", r"^IdleTelvanni", r"^IdleWalkThroughWall",
         r"^IdleGreybeard", r"^IdleT02Ascend", r"Transformation",
         r"^IdleVampireFeast", r"^IdleCannibalFeed", r"^Vampire",
         r"^IdleDA02Boethiah", r"^IdleDLC1Boss", r"^IdleDLC2Tentacle",
         r"^IdleDLC02Tentacle", r"^IdleMQ206Felldir",
     ]),
    ("leer", "Leer y estudiar",
     "leer libro estudiar nota pergamino traducir pagina", [
         r"^IdleBook", r"^IdleNoteRead", r"^IdleStudy", r"^IdleTG06",
         r"^IdleChairReading", r"^ChairReading", r"^IdleRFPickUpScroll",
         r"^IdleMQ203Esbern",
     ]),
    ("gestos", "Gestos y expresión",
     "saludar senalar reir asentir rendirse burlarse gesto encogerse pose", [
         r"^IdleWave", r"^IdleSalute", r"^IdleLaugh", r"^IdlePoint",
         r"ComeThisWay", r"^IdleNervous", r"[Cc]ower", r"^IdleSurrender",
         r"SnapToAttention", r"HandsBehindBack", r"^OffsetArmsCrossed",
         r"[Dd]isbelief", r"^IdleShy", r"^IdleChild", r"^IdleGetAttention",
         r"^IdleLookFar", r"^IdleSilentBow", r"^IdleCleanSword",
         r"^IdleStaticPose", r"^IdleKneel", r"^IdleWipeBrow", r"^idle_A_",
         r"^IdlePlayer", r"^IdleTalkAndUseItem", r"^IdleFrea", r"^idleFrea",
         r"^IdleGrave_", r"^IdleHDRight", r"^IdleHHRight", r"^IdleAstrid",
         r"^IdleValerica", r"^IdleWalkingCamera", r"^IdleMT_DoorBang",
         r"^IdlePresentSkeletonKey", r"^IdleGiveMQ105Horn",
         r"^IdleDrinkFromFountain", r"^IdleFeedChicken",
     ]),
    ("dialogo", "Diálogo", "hablar conversar charlar discutir responder", [
        r"[Dd]ialogue", r"^RF_", r"^Loose", r"^MotionDriven", r"^PairEnd",
    ]),
    ("herido", "Herido y muerte",
     "herido dolor morir sangrar toser levantarse atado ejecucion", [
         r"^IdleWounded", r"^IdleInjured", r"^IdleBracedPain", r"^DeathAnim",
         r"Death", r"UncontrollableCough", r"^GetUpBegin", r"^IdleHandCut",
         r"^IdleBound", r"^OffsetBound", r"^BoundStanding", r"^IdleExecution",
         r"^IdleExecutioner", r"^IdlePrisonerBeat", r"^IdleCart",
         r"FallOnKnees", r"^TG05_", r"^MS12BedDeath", r"^Idle_1stPerson",
         r"^IdleSoupDeath",
     ]),
]

# Lo esencial, con nombre a mano porque es lo que mas se va a usar y el nombre
# automatico ("Force Default State") no le dice nada a nadie.
# Estas van en su propia categoria, la de control. El nombre en espanol lo
# pone traducciones.py como todas las demas; aqui solo estan las palabras
# extra con las que se las tiene que poder encontrar.
CONTROL = {
    "IdleForceDefaultState": ("", "parar detener cancelar normal quieto"),
    "IdleStop": ("", "parar detener cancelar"),
    "IdleStopInstant": ("", "parar detener cancelar instante"),
    "IdleFurnitureExit": ("", "levantarse salir silla cama mueble"),
    "OffsetStop": ("", "soltar dejar manos"),
}

# Las que merecen aparecer primero: son las que de verdad se usan para
# interpretar un papel. El resto sigue estando, solo que mas abajo.
DESTACADAS = [
    "IdleWave", "IdleSalute", "IdleApplaud2", "IdleLaugh", "IdlePointFar_01",
    "IdleComeThisWay", "IdleSurrender", "IdleCowering", "IdleNervous",
    "IdleHandsBehindBack", "OffsetArmsCrossedStart", "IdleSnapToAttention",
    "IdlePray", "IdleBlessingKneelEnter", "IdleKneelingEnter",
    "IdleChairFrontEnter", "IdleStoolEnter", "IdleBedLeftEnterStart",
    "IdleLounge", "IdleWallLeanStart", "IdleRailLeanEnter",
    "IdleLuteStart", "IdleFluteStart", "IdleDrumStart", "IdleCiceroDance1",
    "IdleDrink", "idleEatingStandingStart", "idleDrinkingStandingStart",
    "IdleWarmHandsStanding", "IdleBook_Read", "IdleNoteRead", "IdleStudy",
    "IdleWoodChopStart", "IdleBlackSmithingEnterStart",
    "idleLooseSweepingStart", "IdleHoe", "IdlePickaxeEnter",
    "IdleWounded_01", "IdleInjured", "IdleForceDefaultState",
]


def bonito(edid, enam):
    """Convierte IdleWarmHandsStanding en "Warm Hands Standing".

    Se prefiere el EDID cuando existe: es el nombre que le puso Bethesda en el
    editor y suele describir mejor la pose que el nombre del evento.
    """
    bruto = edid or enam
    bruto = re.sub(r"^(Idle|idle)", "", bruto)
    bruto = re.sub(r"^(pa_|RF_|MC_)", "", bruto)
    bruto = bruto.replace("_", " ")
    # Parte donde cambia a mayuscula: WarmHands -> Warm Hands. La segunda regla
    # evita romper siglas: DLC02Tentacle -> DLC02 Tentacle, no D L C 02.
    bruto = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", bruto)
    bruto = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", bruto)
    return re.sub(r"\s+", " ", bruto).strip() or enam


def categoria(enam, edid):
    """Primera regla que encaje, mirando el evento y tambien el EDID."""
    for clave, _nombre, _claves, patrones in CATEGORIAS:
        for p in patrones:
            if re.search(p, enam) or (edid and re.search(p, edid)):
                return clave
    return "otras"


def porQueNoSincroniza(enam):
    bajo = enam.lower()
    if "equip" in bajo and "torch" not in bajo:
        return MOTIVO_EQUIP
    for clave, motivo in NO_SINCRONIZA.items():
        if enam == clave or enam.startswith(clave):
            return motivo
    return None


def generar(data):
    crudo = []
    for nombre in PLUGINS:
        ruta = os.path.join(data, nombre)
        if not os.path.isfile(ruta):
            print("  (no esta, se salta):", nombre)
            continue
        hallados = idles.idles(ruta)
        print("  %-18s %4d registros IDLE con evento" % (nombre, len(hallados)))
        crudo += hallados

    # Un mismo evento aparece en muchos IDLE distintos (uno por condicion);
    # nos queda el primero, y si luego aparece otro con EDID, ese.
    porEvento = collections.OrderedDict()
    for edid, enam, dnam in crudo:
        ruta = dnam.replace(chr(92), "/").lower()
        if "actors/character" not in ruta:
            continue                    # es de una criatura, no de una persona
        if enam not in porEvento or (edid and not porEvento[enam][0]):
            porEvento[enam] = (edid, dnam)

    porClave = dict((c[0], c) for c in CATEGORIAS)
    animaciones = []
    for enam, (edid, dnam) in porEvento.items():
        if enam == "00NextClip":
            continue                    # pegamento interno, no es una pose
        clave = categoria(enam, edid)
        ingles = bonito(edid, enam)
        ficha = {
            "evento": enam,
            "nombre": traducciones.traducir(enam, ingles),
            "categoria": clave,
            # El nombre original entra en las palabras de busqueda: asi
            # buscar "chair" sigue encontrando las sillas aunque en la lista
            # pongan "Sentarse de frente".
            "busqueda": ingles,
            "categoria_busqueda": porClave.get(clave, (0, 0, "", 0))[2],
            "origen": "vanilla",
        }
        if enam in CONTROL:
            ficha["busqueda"] = ingles + " " + CONTROL[enam][1]
            ficha["categoria"] = "control"
        if enam in DESTACADAS:
            ficha["destacada"] = True
        motivo = porQueNoSincroniza(enam)
        if motivo:
            ficha["sincroniza"] = False
            ficha["motivo"] = motivo
        animaciones.append(ficha)

    animaciones.sort(key=lambda a: (a["categoria"], a["nombre"].lower()))
    return animaciones


if __name__ == "__main__":
    data = sys.argv[1] if len(sys.argv) > 1 else RUTA_POR_DEFECTO
    print("Leyendo animaciones de:", data)
    animaciones = generar(data)

    nombres = dict((c[0], c[1]) for c in CATEGORIAS)
    nombres["control"] = "Control"
    nombres["otras"] = "Otras"
    cuenta = collections.Counter(a["categoria"] for a in animaciones)
    print()
    for clave, n in cuenta.most_common():
        print("  %-10s %-24s %4d" % (clave, nombres.get(clave, clave), n))
    sinSinc = [a for a in animaciones if a.get("sincroniza") is False]
    print()
    print("  total %d animaciones, %d destacadas, %d que SkyMP no sincroniza" %
          (len(animaciones),
           sum(1 for a in animaciones if a.get("destacada")),
           len(sinSinc)))

    faltan = [e for e in DESTACADAS
              if not any(a["evento"] == e for a in animaciones)]
    if faltan:
        print("  OJO: destacadas que no existen en este Skyrim:", faltan)

    salida = os.path.join(RAIZ, "catalogo", "vanilla.json")
    io.open(salida, "w", encoding="utf-8").write(json.dumps({
        "version": 1,
        "fuente": "registros IDLE de " + ", ".join(PLUGINS),
        "categorias": [{"clave": c[0], "nombre": c[1], "busqueda": c[2]}
                       for c in CATEGORIAS] +
                      [{"clave": "control", "nombre": "Control",
                        "busqueda": "parar detener cancelar"},
                       {"clave": "otras", "nombre": "Otras", "busqueda": ""}],
        "animaciones": animaciones,
    }, ensure_ascii=False, indent=1))
    print("  escrito", salida)
