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
import csv
import decisiones
import categorias as categoriasPorNombre
import descartes
import idles
import neutral
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
# ---------------------------------------------------------------------------
# Categorias que se funden en otra. Las reglas de arriba siguen distinguiendolas
# —que es util para clasificar— pero al jugador se le ensenan juntas: una lista
# de veinte pestanas no se lee, y varias se quedaban en nueve o diez
# animaciones visibles.
#
# Para deshacer una fusion basta con quitar su linea.
# ---------------------------------------------------------------------------
FUSIONES_CATEGORIA = {
    "beber": "comer",           # beber y comer son la misma mesa
    "rituales": "magia",        # un ritual es magia con ceremonia
    "acarrear": "oficios",      # llevar y recoger es trabajo
    "cautiverio": "herido",     # preso y herido van juntos en lo narrativo
}

# Los nombres cambian al fundirse.
RENOMBRA = {
    "comer": "Comer y beber",
    "magia": "Magia y rituales",
    "herido": "Herido y cautiverio",
}

CATEGORIAS = [
    # ---------------------------------------------------------------------
    # Las mas concretas van primero: gana la primera regla que encaja, y si
    # "combate" fuera antes se quedaria con casi todo lo de aqui.
    # ---------------------------------------------------------------------
    ("remates", "Remates", "remate golpe de gracia ejecucion matar acabar", [
        r"KillMove", r"^pa_", r"ExecutionNextClip",
    ]),
    ("cautiverio", "Cautiverio", "preso maniatado atado ataduras carcel reo", [
        r"[Pp]risoner", r"Bound", r"Tied", r"Shackle",
    ]),
    ("montar", "Montar", "caballo dragon montura cabalgar jinete", [
        r"Horse", r"Mounted", r"Dragon", r"^Mount", r"Ground_Dismount",
    ]),
    # Combate va ANTES que moverse: "attackStartSprint" es un ataque aunque
    # lleve Sprint en el nombre, y moverse se lo quedaba.
    ("combate", "Combate", "pelear luchar atacar espada arco escudo grito", [
        r"^combatStance",
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
    ("moverse", "Moverse", "saltar correr frenar nadar caer aterrizar andar", [
        r"^Jump", r"Sprint", r"^Brake", r"^move", r"^turn", r"^CannedTurn",
        r"[Ss]wim", r"^MT_", r"^BatSprint", r"^Strafe", r"^cannedTurn",
    ]),
    ("rituales", "Rituales y ceremonias",
     "ritual ceremonia altar iniciacion gremio solemne bendicion", [
         r"[Rr]itual", r"Ceremony", r"Initiat", r"Nocturnal", r"Vigilant",
         r"^IdleAltar", r"^IdleWayShrine",
     ]),
    ("acarrear", "Acarrear y recoger",
     "llevar recoger cargar dejar cesto bandeja carro saco", [
         r"[Cc]arry", r"PickUp", r"OffsetCarry", r"[Cc]art", r"PutDown",
     ]),
    ("beber", "Beber", "beber jarra copa trago hidromiel brindar borracho", [
        r"[Dd]rink", r"Mug", r"Toast", r"Mead", r"Bar[Dd]rinking",
    ]),
    ("sentarse", "Sentarse y apoyarse",
     "sentarse silla taburete banco mesa barra apoyarse trono", [
         r"[Cc]hair", r"[Ss]tool", r"^IdleTable", r"^idleTable", r"[Cc]ounter",
         r"^IdleJarl", r"^IdleLounge", r"[Rr]ailLean", r"[Ww]allLean",
         r"^IdleAltarEnter", r"^IdleWallSoldier", r"^IdleHideR",
         r"^IdleWallCornerPeek",
      r"^IdleSitCrossLegged", r"^IdleSitLedge", r"^IdleLeanTable", r"^IdleHideLEnter",
     ]),
    ("dormir", "Dormir y tumbarse",
     "dormir cama tumbarse acostarse ataud desmayarse suelo", [
         r"[Bb]ed", r"[Cc]offin", r"PassOut", r"SleepNod", r"LayOnFloor",
         r"^IdleWeb",
      r"^IdleLayDownEnter",
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
      r"^IdleAlchemy", r"^IdleEnchanting", r"^IdleSmelter", r"^IdleTanning", r"^IdleOven", r"^IdleGrainMill", r"^IdleMillLoad", r"^IdleCookingPot", r"^IdleCookingSpit", r"^IdleHammer", r"^IdleLeverPush", r"^IdleScrapeTree", r"^IdleLadder", r"^IdleActivateDoor",
     ]),
    ("comer", "Comer",
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
    ("magia", "Magia",
     "rezar orar ritual altar bendicion meditar pergamino transformarse", [
         r"^IdlePray", r"BlessingKneel", r"[Rr]itual", r"^IdleMagic_",
         r"[Mm]esmerize", r"Meditate", r"ElderScroll", r"[Nn]octurnal",
         r"^IdleBoyRitual", r"^IdleCO2Ceremony", r"^IdleBloodPortal",
         r"^IdleSnowElfPrince", r"^IdleTelvanni", r"^IdleWalkThroughWall",
         r"^IdleGreybeard", r"^IdleT02Ascend", r"Transformation",
         r"^IdleVampireFeast", r"^IdleCannibalFeed", r"^Vampire",
         r"^IdleDA02Boethiah", r"^IdleDLC1Boss", r"^IdleDLC2Tentacle",
         r"^IdleDLC02Tentacle", r"^IdleMQ206Felldir",
      r"^DualMagic", r"^SpellRelease",
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


# ---------------------------------------------------------------------------
# Las que las reglas colocan mal. Las reglas aciertan con casi todas, pero unas
# cuantas caen donde no toca porque su nombre no dice de que van: una ceremonia
# del Gremio no lleva "ritual" en el evento, y la telarana estaba en "dormir"
# por eso de estar tumbado.
#
# Esto se mira DESPUES de las reglas y manda sobre ellas.
# ---------------------------------------------------------------------------
RECOLOCAR = {
    # leer un pergamino es leer, por magico que sea el pergamino
    "IdleReadElderScroll": "leer",
    "IdleReadElderScroll3rdP": "leer",
    "IdleReadElderScrollLonger": "leer",
    "IdleReadElderScrollEnd": "leer",
    "IdleMQ206FelldirShowScroll": "leer",
    # y sentarse es sentarse, aunque la animacion sea de crio
    "IdleChildLegsOutStart": "sentarse",
    "IdleChildSitOnKnees": "sentarse",
    # leer un pergamino es leer, por magico que sea el pergamino
    "IdleReadElderScroll": "leer",
    "IdleReadElderScroll3rdP": "leer",
    "IdleReadElderScrollLonger": "leer",
    "IdleReadElderScrollEnd": "leer",
    "IdleMQ206FelldirShowScroll": "leer",
    # y sentarse es sentarse, aunque la animacion sea de crio
    "IdleChildLegsOutStart": "sentarse",
    "IdleChildSitOnKnees": "sentarse",
    "ChairDrinkingStart": "comer",
    "ChairEatingStart": "comer",
    "ChairEatingSoupStart": "comer",
    "ChairEatingStart_VampireMeat": "comer",
    "ChairVampireEatingStart": "comer",
    "IdleTableDrinkEnter": "comer",
    "IdleTableMugEnter": "comer",
    "IdleTableDrinkAndMugEnter": "comer",
    "IdleTablePassOutEnter": "comer",
    "VampireFeedingBedLeft": "comer",
    "VampireFeedingBedRight": "comer",
    "VampireFeedingBedRollLeft": "comer",
    "VampireFeedingBedRollRight": "comer",
    "pa_VampireFeedStanding_Front": "comer",
    "pa_VampireFeedStanding_Back": "comer",
    "ChairReadingStart": "leer",
    "ChairReadingIdles": "leer",
    "IdleChairWrite": "oficios",
    "IdleWriteTableChairLeftEnter": "oficios",
    "IdleWriteTableChairRightEnter": "oficios",
    "IdleWriteTableChairLeftExit": "oficios",
    "IdleWriteTableChairRightExit": "oficios",
    "IdleBarCounterWipe": "oficios",
    "IdleCounterStart": "oficios",
    "Lever_PlayerPush": "oficios",
    "IdleAltarEnter": "magia",
    "IdleSnowElfPrinceFireAndForget": "magia",
    "pa_WW_CutWrist": "magia",
    "pa_ExtractWerewolfSpirit": "magia",
    "IdleSnowElfPrinceChairDialogue": "dialogo",
    "IdleWallCornerPeekLEnter": "gestos",
    "IdleWallCornerPeekREnter": "gestos",
    "IdleHideREnter": "gestos",
    "pa_HugA": "gestos",
    "IdleWarmHands": "gestos",
    "IdleWarmHandsStanding": "gestos",
    "IdleWarmHandsCrouched": "gestos",
    "IdleWarmArms": "gestos",
    "IdleVampireFeastVictim": "herido",
    "Ragdoll": "herido",
    "IdleCraftingCookingPotAddIngredient": "oficios",
    "IdleCraftingCookingPotTalkA": "oficios",
    "IdleCraftingCookingPotTalkB": "oficios",
    "IdleDLC02BoatRide": "oficios",
    "IdleActivateCoffinPuzzle": "oficios",
    "IdleTG08_Phase1": "magia",
    "IdleTG08_Phase2": "magia",
    "IdleTG08_Phase3": "magia",
    "IdleTG08_Phase4": "magia",
    "IdleTG08_Phase5": "magia",
    "IdleTGFalmerStatueEnter": "magia",
    "WardBreak": "combate",
    "IdleWebEnterInstant": "herido",
    "IdleWebExit": "herido",
    "IdleWebExitQuickTurn": "herido",
    "IdleWebThrashShort": "herido",
    "IdleWebThrashShort2": "herido",
    "MS12BedDeath": "herido",
    "IdleCannibalFeedStanding": "comer",
    "IdleCannibalFeedCrouching": "comer",
    "IdleNocturnal_LookLeft": "gestos",
    "IdleNocturnal_LookRight": "gestos",
    "IdleCiceroHappy": "gestos",
    "IdleCiceroAgitated": "gestos",
}

# Estas se quitan de la lista. Son la misma pose que su version de adulto, y al
# quitarles el "Nino:" del nombre se llamarian igual que ellas.
FUERA = ["IdleChairCHILDFrontEnter", "IdleChairCHILDLeftEnter", "IdleChairCHILDRightEnter", "IdleChairCHILDFrontExit", "IdleChairCHILDLeftExit", "IdleChairCHILDRightExit"]


# ---------------------------------------------------------------------------
# Las que siguen puestas aunque camines.
#
# Una pose normal anima el esqueleto entero: das un paso y se va, porque la
# animacion de andar gana. Estas no: son de las dos familias que Skyrim monta
# ENCIMA de lo que hagas con las piernas —las Offset (llevar un cesto, los
# brazos cruzados) y las de hablar en movimiento—, asi que se quedan puestas.
#
# Para que una pose cualquiera hiciera esto harian falta ficheros de animacion
# nuevos, y eso no se puede desde aqui.
# ---------------------------------------------------------------------------
ANDANDO = [
    "OffsetCarryBasketStart",
    "OffsetCarryPotStart",
    "OffsetFlowerBasketStart",
    "OffsetCarryFlowerBasketPickStart",
    "OffsetCarryMQ201DrinkTray",
    "OffsetCarryMQ201DrinkR",
    "IdleOffsetCarryPotServe",
    "OffsetArmsCrossedStart",
    "OffsetBoundStandingStart",
    "MotionDrivenDialogueGeneric",
    "MotionDrivenDialogueAngry",
    "MotionDrivenDialogueNextClip",
    "IdleDialogueMovingTalkA",
    "IdleDialogueMovingTalkB",
    "IdleDialogueMovingTalkC",
    "IdleDialogueMovingTalkD",
    "IdleCartDriverIdle",
    "IdleCartDriverSway",
    "IdleValericaWalkForward",
]


# ---------------------------------------------------------------------------
# Las que solo tienen sentido si YA estas sentado.
#
# No te sientan ellas: se montan sobre el estado de estar en una silla. Si el
# mod te levanta antes de mandarlas —como hacia al cambiar de animacion— lo que
# queda es un personaje de pie haciendo como que lee un libro que no tiene.
# ---------------------------------------------------------------------------
SENTADO = [
    "idleChairArmsCrossedVar1",
    "idleChairArmsCrossedVar2",
    "idleChairLookDown",
    "idleChairShoulderFlex",
    "IdleChairVar1",
    "idleChairVar2",
    "IdleChairWrite",
    "ChairReadingStart",
    "ChairReadingIdles",
    "ChairDrinkingStart",
    "ChairEatingStart",
    "ChairEatingSoupStart",
    "ChairEatingStart_VampireMeat",
    "ChairVampireEatingStart",
    "IdleEatSoup",
    "IdleSnowElfPrinceChairDialogue",
]


def bonito(edid, enam):
    """Convierte IdleWarmHandsStanding en "Warm Hands Standing".

    Se prefiere el EDID cuando existe: es el nombre que le puso Bethesda en el
    editor y suele describir mejor la pose que el nombre del evento.
    """
    bruto = edid or enam
    bruto = re.sub(r"^(Idle|idle)", "", bruto)
    bruto = re.sub(r"^(pa_|RF_|MC_)", "", bruto)
    # Bethesda deja sufijos DUPLICATE000 en algunos editor ID cuando copian un
    # registro. No dicen nada de la pose y quedan feisimos en la lista.
    bruto = re.sub(r"DUPLICATE\d*", "", bruto)
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


BEHAVIORS = "meshes/actors/character/behaviors"

# La hoja de revision, exportada a CSV. Lo que este escrito ahi MANDA sobre lo
# que saque el traductor automatico: son nombres y descripciones escritos
# mirando la animacion, y eso siempre gana a una regla.
REVISADO = os.path.join(RAIZ, "catalogo", "revisado.csv")

# Y la hoja completa, que es la de arriba juntada con el catalogo del juego.
# Trae las 737 filas y, sobre todo, las 737 descripciones. La de revision
# muchas veces solo trae el nombre.
COMPLETA = os.path.join(RAIZ, "catalogo", "hoja-completa.csv")


def _porId(ruta):
    """{id: fila} de un CSV, o vacio si no esta."""
    if not os.path.isfile(ruta):
        return {}
    fuera = {}
    with io.open(ruta, encoding="utf-8-sig") as f:
        for fila in csv.DictReader(f):
            clave = (fila.get("id") or "").strip()
            if clave:
                fuera[clave] = fila
    return fuera


def loRevisado():
    """{evento: {nombre, descripcion, estado, ...}} juntando las dos hojas.

    La completa pone el suelo y lo escrito a mano se pone encima, campo a
    campo y solo cuando no esta vacio. De esa forma:

      - lo que tu escribes manda, que lo escribes mirando la animacion
      - y lo que no escribiste no deja un hueco: lo rellena la completa

    Si solo hay una de las dos, se usa esa y ya.
    """
    fuera = {}
    for clave, fila in _porId(COMPLETA).items():
        fuera[clave] = dict(fila)
    for clave, fila in _porId(REVISADO).items():
        if clave not in fuera:
            fuera[clave] = dict(fila)
            continue
        for campo, valor in fila.items():
            if (valor or "").strip():
                fuera[clave][campo] = valor
        # El estado de la hoja completa NO se usa cuando la fila ya esta en la
        # de revision, ni aunque alli este vacio. La completa lo calcula con
        # reglas, y alguna de esas reglas se echo atras despues: marcaba como
        # descartadas las animaciones de salida, y se decidio dejarlas a la
        # vista. Lo que tu tienes revisado manda; la completa solo rellena los
        # huecos de las que no estan en tu hoja.
        if not (fila.get("estado") or "").strip():
            fuera[clave]["estado"] = ""
    return fuera


def eventosDelGrafo(data):
    """Los nombres de evento que acepta el grafo de animacion del jugador.

    Salen de los .hkx del personaje. Son binarios de Havok, pero los nombres
    van dentro como texto plano: se leen las cadenas imprimibles y ya.

    Vacio si la carpeta no esta —en una instalacion limpia el grafo va dentro
    del BSA—, y entonces no se confirma nada.
    """
    carpeta = os.path.join(data, *BEHAVIORS.split("/"))
    if not os.path.isdir(carpeta):
        return set()
    fuera = set()
    for f in sorted(os.listdir(carpeta)):
        if not f.lower().endswith(".hkx"):
            continue
        datos = open(os.path.join(carpeta, f), "rb").read()
        for m in re.finditer(rb"[ -~]{4,}", datos):
            fuera.add(m.group().decode("ascii"))
    return fuera


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

    delGrafo = eventosDelGrafo(data)
    if delGrafo:
        print("  grafo del jugador: %d cadenas en %s" % (len(delGrafo), BEHAVIORS))
    else:
        print("  (sin %s: no se puede confirmar nada contra el grafo)" % BEHAVIORS)

    # Un mismo evento aparece en muchos IDLE distintos (uno por condicion);
    # nos queda el primero, y si luego aparece otro con EDID, ese.
    #
    # Entra si la ruta es de persona O si no tiene ruta pero el grafo del
    # jugador conoce el evento. La ruta dice de que esqueleto es la animacion
    # de ESE registro, no si al jugador se le puede mandar el evento: habia 126
    # animaciones de oficios —cocinar, alquimia, el molino— que se caian por no
    # llevar ruta.
    porEvento = collections.OrderedDict()
    for edid, enam, dnam in crudo:
        ruta = dnam.replace(chr(92), "/").lower()
        esDePersona = "actors/character" in ruta
        if not esDePersona and not (ruta == "" and enam in delGrafo):
            continue                    # de otra criatura, o no la conoce nadie
        if enam not in porEvento or (edid and not porEvento[enam][0]):
            porEvento[enam] = (edid, dnam)

    porClave = dict((c[0], c) for c in CATEGORIAS)
    animaciones = []
    for enam, (edid, dnam) in porEvento.items():
        if enam == "00NextClip":
            continue                    # pegamento interno, no es una pose
        if enam in FUERA:
            continue
        clave = RECOLOCAR.get(enam) or categoria(enam, edid)
        ingles = bonito(edid, enam)
        ficha = {
            # El nombre que le puso Bethesda en el editor. Es la UNICA pista de
            # que hace la animacion, y a veces contradice al evento:
            # IdleKneeling tiene por editorId "CheckCorpse", o sea que no es
            # arrodillarse sino mirar un cadaver. Va al catalogo y a la hoja
            # para poder nombrarlas con criterio.
            "edid": edid,
            "evento": enam,
            "nombre": traducciones.traducir(enam, ingles),
            "categoria": clave,
            # Sin palabras extra: se busca por el nombre y por el id, y el id
            # ya trae el ingles dentro (IdleChairFrontEnter da chair, front,
            # enter al partirlo por sus mayusculas). Meter ademas el EDID solo
            # anadia ruido, y alguno miente: el de blockStart dice BowZoom.
            "busqueda": "",
            "origen": "vanilla",
        }
        if enam in CONTROL:
            # Las de control si llevan palabras extra: "detener", "cancelar"...
            # no salen ni de su nombre ni de su id.
            ficha["busqueda"] = CONTROL[enam][1]
            ficha["categoria"] = "control"
        # Fuera las "(al instante)". Son la misma pose que su version normal,
        # pero saltandose la animacion de entrada: el juego las usa para
        # colocar a un PNJ ya sentado al aparecer. En una lista para elegir a
        # mano solo son la mitad de las entradas duplicadas.
        #
        # Se miran por el NOMBRE y no por el evento: hay tres que acaban en
        # Instant y no son duplicados de nada (meterse en la telarana, Serana
        # en su ataud, de rodillas y maniatado), y esas se quedan.
        if "al instante" in ficha["nombre"].lower():
            continue

        if enam in ANDANDO:
            ficha["andando"] = True

        if enam in SENTADO:
            ficha["sentado"] = True

        if enam in DESTACADAS:
            ficha["destacada"] = True
        # Las que entran por la ruta pero el grafo no nombra. No se borran: no
        # aparecer puede ser que no exista o que el grafo lo componga por
        # partes, asi que se marcan y lo dice quien lo pruebe en el juego.
        if delGrafo and enam not in delGrafo:
            ficha["confirmado"] = False

        motivo = porQueNoSincroniza(enam)
        if motivo:
            ficha["sincroniza"] = False
            ficha["motivo"] = motivo
        animaciones.append(ficha)

    # Lo escrito a mano en la hoja de revision: nombre, descripcion y si se ve.
    # Va ANTES de numerar: si fuera despues, dos nombres escritos iguales se
    # quedarian iguales, y el panel necesita que no se repitan. Numerando
    # despues, los que choquen salen como "(1)" y "(2)" igual que el resto.
    revisado = loRevisado()
    if revisado:
        print("  hoja de revision: %d filas" % len(revisado))
    for a in animaciones:
        fila = revisado.get(a["evento"])
        if not fila:
            # Si no esta en la hoja, no esta revisada: escondida hasta que lo
            # este. Es mas seguro que al reves, que es como salian cosas en la
            # rueda sin que nadie las hubiera mirado.
            a["visible"] = False
            continue
        nombre = (fila.get("nombre") or "").strip()
        if nombre:
            a["nombre"] = neutral.neutral(nombre)
        desc = (fila.get("descripción") or fila.get("descripcion") or "").strip()
        if desc:
            a["descripcion"] = neutral.neutral(desc)
        # Lo que se ve lo decide la columna "estado", y solo ella: Aceptado
        # se ve, cualquier otra cosa no. Antes habia tres capas decidiendo lo
        # mismo —esta, las reglas por familias y las correcciones a mano— y
        # para saber por que una animacion salia o no habia que seguir las
        # tres. La hoja ya esta revisada entera, asi que manda ella.
        if (fila.get("estado") or "").strip().lower() != "aceptado":
            a["visible"] = False

    # El espanol neutral, a TODO: hasta ahora solo pasaba por el filtro lo que
    # venia de la hoja, y los nombres del traductor se quedaban con "cubo",
    # "puchero" y demas. Ver herramientas/neutral.py.
    for a in animaciones:
        a["nombre"] = neutral.neutral(a["nombre"])

    # Las categorias que se funden. Se hace aqui y no en las reglas para que
    # las reglas sigan siendo concretas: clasificar bien es una cosa y ensenar
    # pocas pestanas es otra.
    for a in animaciones:
        a["categoria"] = FUSIONES_CATEGORIA.get(a["categoria"], a["categoria"])

    # Y la categoria se decide por el NOMBRE, no por el id. El id y lo que hace
    # la animacion no siempre coinciden —el editorId no coincide con el evento
    # en 456 de las 737— y se notaba: "Golpear el suelo" estaba en magia, y
    # "Entregar algo" salia partido entre magia y oficios. El nombre esta
    # escrito mirando la animacion, asi que es mejor dato.
    # Ver herramientas/categorias.py.
    cambiadas = categoriasPorNombre.aplicar(animaciones)
    print("  categoria por el nombre: %d cambian de sitio" % len(cambiadas))

    # Numerar solo lo que NO viene de la hoja. Los nombres de la hoja ya
    # llevan su letra cuando se repiten —"Baile (A)", "Baile (B)"— y numerar
    # encima daria "Baile (A) (1)".
    numerarRepetidos([a for a in animaciones if a["evento"] not in revisado])

    seVen = sum(1 for a in animaciones if a.get("visible") is not False)
    print("  la hoja deja a la vista %d de %d" % (seVen, len(animaciones)))

    animaciones.sort(key=lambda a: (a["categoria"], a["nombre"].lower()))
    return animaciones


def numerarRepetidos(animaciones):
    """Numera las que acaban llamandose igual: "Remate (1)", "Remate (2)"...

    Pasa sobre todo con los remates, que ya no nombran al bicho contra el que
    son, pero tambien cada vez que se limpia un nombre. Antes habia que ir
    cazando los choques a mano; asi se numeran solos y en el orden del juego.
    """
    cuantas = {}
    for a in animaciones:
        cuantas[a["nombre"]] = cuantas.get(a["nombre"], 0) + 1

    vistas = {}
    for a in animaciones:
        if cuantas[a["nombre"]] < 2:
            continue
        base = a["nombre"]
        vistas[base] = vistas.get(base, 0) + 1
        a["nombre"] = "%s (%d)" % (base, vistas[base])


if __name__ == "__main__":
    data = sys.argv[1] if len(sys.argv) > 1 else RUTA_POR_DEFECTO
    print("Leyendo animaciones de:", data)
    animaciones = generar(data)

    # El resumen, con las categorias de ahora y contando solo lo que se ve:
    # el total incluye 510 escondidas y leerlo asi enganaba.
    nombres = dict((c[0], c[1]) for c in categoriasPorNombre.LISTA)
    aLaVista = [a for a in animaciones if a.get("visible") is not False]
    cuenta = collections.Counter(a["categoria"] for a in aLaVista)
    extra = collections.Counter()
    for a in aLaVista:
        for c in a.get("tambien", []):
            extra[c] += 1
    print()
    for clave, _ in sorted(cuenta.items(), key=lambda x: -x[1]):
        print("  %-10s %-22s %4d  (+%d de otras)"
              % (clave, nombres.get(clave, clave), cuenta[clave], extra[clave]))
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
        # La lista sale de categorias.py, que es donde se decide a cual va
        # cada animacion. Dos listas diciendo lo mismo acaban diciendo cosas
        # distintas.
        "categorias": [{"clave": c[0], "nombre": c[1], "busqueda": c[2]}
                       for c in categoriasPorNombre.LISTA],
        "animaciones": animaciones,
    }, ensure_ascii=False, indent=1))
    print("  escrito", salida)
