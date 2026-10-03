# -*- coding: utf-8 -*-
u"""Que animacion es la salida de cual.

Muchas poses son de DOS piezas: una que te mete y otra que te saca. Sentarse en
una silla y levantarse. Recoger una piedra y soltarla. Y la de salida no se
puede lanzar sola: si no estas sentado, levantarse no hace nada.

Esta tabla dice, para cada animacion de entrada, cual es su salida. Sirve para
tres cosas a la vez:

  - la hoja: la salida se marca como descartada, porque no es una pose que uno
    elija; y la entrada lleva en su dependencia de que depende.
  - el mod: al pulsar Detener sobre una pose que tiene salida, se manda SU
    salida en vez del corte generico. Soltar la piedra en vez de que se
    desvanezca de la mano.
  - la busqueda: las salidas no salen en la lista, asi que no estorban.

De donde sale
-------------
Las que cuadran por nombre —XEnter/XExit, XStart/XStop— se sacan solas con
parejaPorNombre(). Las demas no cuadran porque Bethesda las llamo de otra
manera: recoger es PickUp y soltar es PutDown, levantarse de la silla es
ChairExitStart y sentarse es IdleChairEnter. Esas van escritas aqui.
"""
import re

# entrada -> salida. Escritas a mano: por nombre no se parecen.
PAREJAS = {
    # --- objetos que se recogen y se sueltan ------------------------------
    "IdleStonePickUpEnter": "IdleStonePutDownEnter",
    "IdleWoodPickUpEnter": "IdlewoodputdownEnter",
    "OffsetCarryBasketStart": "OffsetStop",
    "OffsetCarryPotStart": "OffsetStop",
    "OffsetCarryBucketStart": "OffsetStop",
    "OffsetCarryFlowerBasketPickStart": "OffsetStop",
    "OffsetCarryLogStart": "OffsetStop",
    "IdleOffsetCarryPotServe": "OffsetStop",

    # --- sillas ------------------------------------------------------------
    "IdleChairEnter": "IdleChairExitStart",
    "IdleChairFrontEnter": "IdleChairFrontExit",
    "IdleChairLeftEnter": "idleChairLeftExit",
    "IdleChairRightEnter": "idleChairRightExit",
    "IdleStoolEnter": "IdleStoolBackExit",
    "IdleStoolEnterPlayer": "IdleStoolBackExit",
    "IdleTableEnter": "IdleTableBackExit",
    "IdleTableEnterPlayer": "IdleTableBackExit",
    "IdleWriteTableChairLeftEnter": "IdleWriteTableChairLeftExit",
    "IdleWriteTableChairRightEnter": "IdleWriteTableChairRightExit",
    "IdleLounge_Enter": "IdleLounge_Exit",
    "IdleRailLeanEnter": "IdleRailLeanExit",
    "IdleBarCounterEnter": "IdleFurnitureExit",
    "IdleCounterStart": "IdleFurnitureExit",
    "IdleSitCrossLeggedEnter": "IdleFurnitureExit",
    "IdleSitLedgeEnter": "IdleFurnitureExit",
    "IdleLeanTableEnter": "IdleFurnitureExit",

    # --- camas y ataudes ---------------------------------------------------
    "IdleBedEnterStart": "IdleBedExitStart",
    "IdleBedLeftEnterStart": "IdleBedExitStart",
    "IdleBedRightEnterStart": "IdleBedExitStart",
    "IdleBedRollFrontEnterStart": "IdleBedExitStart",
    "IdleBedRollLeftEnterStart": "IdleBedExitStart",
    "IdleBedRollRightEnterStart": "IdleBedExitStart",
    "IdleCoffinEnter": "IdleFurnitureExit",
    "IdleLayDownEnter": "IdleFurnitureExit",

    # --- mesas y mueble de trabajo ----------------------------------------
    "IdleAlchemyEnter": "IdleFurnitureExit",
    "IdleEnchantingEnter": "IdleFurnitureExit",
    "IdleSmelterEnter": "IdleFurnitureExit",
    "IdleTanningEnter": "IdleFurnitureExit",
    "IdleOvenEnter": "IdleFurnitureExit",
    "IdleGrainMillEnter": "IdleFurnitureExit",
    "IdleCookingPotEnter": "IdleFurnitureExit",
    "IdleCookingSpitEnter": "IdleFurnitureExit",
    "IdleBlackSmithForgeEnter": "IdleFurnitureExit",
    "IdleHammerTableEnter": "IdleFurnitureExit",
    "IdleHammerWallEnter": "IdleFurnitureExit",
    "IdleHammerCarpenterTableEnter": "IdleFurnitureExit",
    "IdlePickaxeTableEnter": "IdleFurnitureExit",
    "IdlePickaxeFloorEnter": "IdleFurnitureExit",
    "IdleDLC2PickaxeEnter": "IdleFurnitureExit",
    "IdleDLC2PickaxeTableEnter": "IdleFurnitureExit",
    "IdleDLC2PickaxeFloorEnter": "IdleFurnitureExit",
    "IdleLadderEnter": "IdleFurnitureExit",
    "IdleHideLEnter": "IdleFurnitureExit",

    # --- monturas y carro --------------------------------------------------
    "HorseEnter": "HorseExit",
    "DragonMountEnter": "DragonMountExit",
    "IdleCartTravelDriverEnter": "IdleCartDriverExit",
    "IdleCartTravelPlayerEnter": "IdleCartPrisonerAExit",

    # --- telarana ----------------------------------------------------------
    "IdleWebEnter": "IdleWebExit",

    # --- gestos con principio y fin ---------------------------------------
    "idleDisbelief01Start": "idleDisbelief01Exit",
    "idleDisbelief02Start": "idleDisbelief02Exit",
    "idleFreaSorrowLoopEnter": "idleFreaSorrowExit",
    "IdleFreaDisbelief2LoopStart": "IdleFreaDisbelief2LoopStop",
    "IdleMesmerizeStart": "IdleMesmerizeStop",
    "IdleNocturnalEnter": "IdleNocturnal_Exit",
    "IdleReadElderScrollStart": "IdleReadElderScrollEnd",
    "IdleWalkingCameraStart": "IdleWalkingCameraEnd",
    "IdleChildCryingStart": "IdleChildCryingEnd",
    "IdleDLC02TentacleWordBurnStart": "IdleDLC02TentacleWordBurnEnd",
    "DrunkStart": "DrunkStop",
}

# Las que cuadran solas por como se llaman.
SUFIJOS = [("Enter", "Exit"), ("Start", "Stop"), ("Start", "End")]


def parejaPorNombre(evento, existe):
    u"""La salida de este evento si se deduce del nombre, o None."""
    for ini, fin in SUFIJOS:
        if evento.endswith(ini):
            cand = evento[:-len(ini)] + fin
            if cand != evento and existe(cand):
                return cand
    return None


def salidaDe(evento, existe=lambda e: True):
    u"""La animacion de salida de esta, o None si no tiene."""
    if evento in PAREJAS:
        salida = PAREJAS[evento]
        return salida if existe(salida) else None
    return parejaPorNombre(evento, existe)


def construirMapa(eventos):
    u"""{entrada: salida} para los eventos que existan de verdad."""
    hay = set(eventos)
    mapa = {}
    for e in eventos:
        s = salidaDe(e, lambda x: x in hay)
        if s and s != e:
            mapa[e] = s
    return mapa


def salidas(eventos):
    u"""El conjunto de eventos que son SALIDA de alguna otra."""
    return set(construirMapa(eventos).values())
