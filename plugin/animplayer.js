/* ===========================================================================
 * AnimPlayer — reproductor de animaciones para SkyMP / SkyrimPlatform
 * ===========================================================================
 *
 * QUE ES
 *   Con F3 aparece en la esquina de arriba a la derecha la lista de animaciones
 *   de Skyrim con una barra de busqueda. Escribes, pulsas una, y tu personaje
 *   la hace. F3 otra vez, o Esc, y se va.
 *
 *   Sale directamente abierto: no hay pestana que pulsar antes. Una tecla, la
 *   lista, y a buscar.
 *
 *   La casilla "En bucle" del pie la deja repitiendose hasta que pulsas Parar.
 *   Sin marcar, se reproduce una sola vez.
 *
 * COMO ESTA ORGANIZADO
 *   El archivo va de dentro hacia fuera, en cinco capas. Cada una solo conoce
 *   a la de debajo, y estan separadas a proposito:
 *
 *     1. CATALOGO      Los datos. Que animaciones hay. Se genera desde el
 *                      propio Skyrim instalado (herramientas/), nunca a mano.
 *
 *     2. REPRODUCTOR   Lo unico de todo el archivo que toca el juego. Una
 *                      funcion para reproducir y una para parar. Nada mas.
 *
 *     3. TRANSPORTE    A donde va una peticion de animacion: se ejecuta aqui
 *                      mismo, o se manda al servidor. Esta separado porque el
 *                      dia que el servidor sincronice animaciones por su
 *                      cuenta, solo hay que cambiar de transporte: ni la
 *                      interfaz ni el reproductor se enteran.
 *
 *     4. INTERFAZ      El panel. No vive aqui: vive en la pagina del navegador
 *                      de SkyMP. Se escribe como una funcion normal y se manda
 *                      a la pagina convertida en texto (ver "LA INTERFAZ VIVE
 *                      EN LA PAGINA" mas abajo).
 *
 *     5. PEGAMENTO     La tecla, el foco del navegador, los mensajes que llegan
 *                      de la pagina, y la cola de acciones. Lo aburrido pero
 *                      imprescindible.
 *
 *     6. LA PUERTA     Lo que otros mods pueden llamar para pedir animaciones,
 *                      publicado en sp.storage.AnimPlayer. Un mod de musica
 *                      que haga tocar el laud entra por aqui.
 *
 * LO QUE HAY QUE SABER ANTES DE TOCAR NADA
 *
 *   · Una animacion se reproduce mandando un EVENTO al grafo de Havok del
 *     personaje: Debug.sendAnimationEvent(actor, "IdleWave"). El nombre tiene
 *     que existir; si no existe, no pasa nada. Ni error, ni animacion. De ahi
 *     que el catalogo se saque del juego y no se invente.
 *
 *   · La sincronizacion entre jugadores SALE GRATIS. SkyMP tiene un enganche
 *     en sendAnimationEvent, ve el evento que acabamos de mandar y lo reenvia
 *     al servidor por su cuenta. No hay que hacer nada. El detalle, con las
 *     excepciones, esta en docs/sincronizacion.md.
 *
 *   · Las llamadas al juego NO se pueden hacer dentro del callback de un
 *     mensaje del navegador: el juego responde "can't be called in this
 *     context". Hay que encolarlas y ejecutarlas en el siguiente "update".
 *     Esto no es una teoria: es el mismo problema que documenta el mod de
 *     inventario del servidor en su propio codigo.
 *
 *   · En primera persona las poses no se ven. Por eso al reproducir se pasa a
 *     tercera persona, salvo que se desactive en los ajustes.
 *
 *   · F3 y no otra: F2 es el inventario de este servidor, F4 esconde la
 *     interfaz de SkyMP, F6 cambia el foco del navegador, F5 y F9 son el
 *     guardado y la carga rapidos, y F12 la captura de Steam.
 *
 * INSTALACION
 *   Copiar este archivo y animplayer-settings.txt a
 *       Skyrim Special Edition/Data/Platform/PluginsDev/
 *   (o usar instalar.ps1, que lo busca y lo copia). No hace falta compilar
 *   nada: es JavaScript, SkyrimPlatform lo carga tal cual.
 *
 * =========================================================================== */

(function () {
  'use strict';

  /* SkyrimPlatform expone su API de dos formas segun como se cargue el plugin.
     Se prueban las dos: asi el mismo archivo sirve puesto a mano en
     PluginsDev y empaquetado con webpack como el ejemplo oficial. */
  var sp = null;
  try { sp = globalThis.skyrimPlatform; } catch (e) { /* no existe: probamos abajo */ }
  if (!sp) { try { sp = require('skyrimPlatform'); } catch (e2) { sp = null; } }
  if (!sp) { return; }                     // no estamos dentro de SkyrimPlatform

  var NOMBRE = 'animplayer';

  function apuntar(texto) {
    try { sp.printConsole('[' + NOMBRE + '] ' + texto); } catch (e) { /* da igual */ }
  }

  /* Los ajustes salen de animplayer-settings.txt, que SkyrimPlatform lee y
     deja en sp.settings con el nombre del plugin. Si el archivo no esta o esta
     mal escrito llega vacio, y entonces valen los valores de por defecto que
     se aplican justo debajo. El mod tiene que funcionar sin ese archivo. */
  var ajustes = {};
  try { ajustes = (sp.settings && sp.settings[NOMBRE]) || {}; } catch (e) { ajustes = {}; }

  function opcion(clave, pordefecto) {
    return (ajustes[clave] === undefined || ajustes[clave] === null)
      ? pordefecto : ajustes[clave];
  }

  /* F3. Es la unica tecla de funcion que queda libre con este servidor:
       F2  el inventario del servidor          F4  esconde la interfaz de SkyMP
       F5  guardado rapido de Skyrim           F6  cambia el foco del navegador
       F9  carga rapida de Skyrim              F12 la captura de pantalla de Steam
     Se puede cambiar en animplayer-settings.txt, pero si se pone una de esas
     las dos cosas ocurren a la vez. */
  var TECLA = opcion('tecla', 61);              // 61 = F3 (codigo DIK)
  var INTERVALO_BUCLE = opcion('intervaloBucle', 3000);
  var RECARGAR_AL_REINICIAR = opcion('recargarAlReiniciar', true);
  var ESPERA_AL_CAMBIAR = opcion('esperaAlCambiar', 333);
  var PARAR_AL_SALTAR = opcion('pararAlSaltar', true);
  var DURACION_MAXIMA = opcion('duracionMaxima', 10000);
  var LIMPIAR_AL_MOVERSE = opcion('limpiarAlMoverse', true);
  var GRACIA_TRAS_LANZAR = opcion('graciaTrasLanzar', 1000);
  var TERCERA_PERSONA = opcion('forzarTerceraPersona', true);
  var QUITAR_MOVIMIENTO = opcion('quitarMovimiento', true);
  var TRANSPORTE = opcion('transporte', 'local');
  var SERVIDOR = opcion('servidor', {});
  var MARGEN_CARGA = opcion('margenTrasPantallaDeCarga', 15000);

  /* =======================================================================
   * CAPA 1 — EL CATALOGO
   * =======================================================================
   *
   * El bloque de abajo lo escribe herramientas/generar-plugin.py leyendo
   * catalogo/vanilla.json, que a su vez sale de los registros IDLE del Skyrim
   * instalado. No se edita a mano: se regenera.
   *
   * Cada ficha:
   *     evento       lo que se manda al juego. Es lo unico obligatorio.
   *     nombre       lo que se ve en la lista
   *     categoria    para agrupar y filtrar
   *     busqueda     palabras en espanol que tambien encuentran esta ficha
   *     destacada    aparece arriba, en "Recomendadas"
   *     sincroniza   si es false, los demas jugadores NO la veran, y el panel
   *     motivo       lo avisa con este texto
   *
   * Para anadir animaciones de otros mods NO hay que tocar esto: se ponen en
   * la lista "animaciones" de animplayer-settings.txt y se suman al catalogo
   * al arrancar (ver mezclarCatalogo, mas abajo).
   * ======================================================================= */

  // >>> CATALOGO GENERADO — no editar a mano >>>
  var CATALOGO = {
    "version": 1,
    "categorias": [
      {"clave": "combate", "nombre": "Combate", "busqueda": "pelear luchar atacar espada arco escudo grito"},
      {"clave": "sentarse", "nombre": "Sentarse y apoyarse", "busqueda": "sentarse silla taburete banco mesa barra apoyarse trono"},
      {"clave": "dormir", "nombre": "Dormir y tumbarse", "busqueda": "dormir cama tumbarse acostarse ataud desmayarse suelo"},
      {"clave": "oficios", "nombre": "Oficios y tareas", "busqueda": "trabajar herrero minar talar barrer granja escribir recoger"},
      {"clave": "comer", "nombre": "Comer y beber", "busqueda": "comer beber cenar hidromiel sopa brindar calentarse manos fuego"},
      {"clave": "musica", "nombre": "Música y fiesta", "busqueda": "musica bailar tocar laud flauta tambor aplaudir animar cuerno vitorear"},
      {"clave": "magia", "nombre": "Magia y rituales", "busqueda": "rezar orar ritual altar bendicion meditar pergamino transformarse"},
      {"clave": "leer", "nombre": "Leer y estudiar", "busqueda": "leer libro estudiar nota pergamino traducir pagina"},
      {"clave": "gestos", "nombre": "Gestos y expresión", "busqueda": "saludar senalar reir asentir rendirse burlarse gesto encogerse pose"},
      {"clave": "dialogo", "nombre": "Diálogo", "busqueda": "hablar conversar charlar discutir responder"},
      {"clave": "herido", "nombre": "Herido y muerte", "busqueda": "herido dolor morir sangrar toser levantarse atado ejecucion"},
      {"clave": "control", "nombre": "Control", "busqueda": "parar detener cancelar"},
      {"clave": "otras", "nombre": "Otras", "busqueda": ""}
    ],
    "animaciones": [
      {"evento": "SneakStart", "nombre": "Agacharse", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "MRh_SpellAimedStart", "nombre": "Apuntar con un hechizo, derecha", "categoria": "combate"},
      {"evento": "MLh_SpellAimedStart", "nombre": "Apuntar con un hechizo, izquierda", "categoria": "combate"},
      {"evento": "attackStart", "nombre": "Atacar", "categoria": "combate"},
      {"evento": "attackStart_MC_1HMRight", "nombre": "Atacar con la derecha (una mano)", "categoria": "combate"},
      {"evento": "attackStartLeftHand", "nombre": "Atacar con la izquierda", "categoria": "combate"},
      {"evento": "attackStart_MC_1HMLeft", "nombre": "Atacar con la izquierda (una mano)", "categoria": "combate"},
      {"evento": "attackStartDualWield", "nombre": "Atacar con las dos armas", "categoria": "combate"},
      {"evento": "attackPowerStartRightLeftHand", "nombre": "Ataque potente a la derecha, con la izquierda", "categoria": "combate"},
      {"evento": "attackPowerStartLeftLeftHand", "nombre": "Ataque potente a la izquierda, con la izquierda", "categoria": "combate"},
      {"evento": "attackPowerStart_MC_1HMRight", "nombre": "Ataque potente con la derecha (una mano)", "categoria": "combate"},
      {"evento": "attackPowerStart_MC_1HMLeft", "nombre": "Ataque potente con la izquierda (una mano)", "categoria": "combate"},
      {"evento": "attackPowerStartDualWield", "nombre": "Ataque potente con las dos armas", "categoria": "combate"},
      {"evento": "attackPowerStartInPlaceLeftHand", "nombre": "Ataque potente en el sitio, con la izquierda", "categoria": "combate"},
      {"evento": "attackPowerStartBackLeftHand", "nombre": "Ataque potente hacia atrás, con la izquierda", "categoria": "combate"},
      {"evento": "attackPowerStartLeft", "nombre": "Ataque potente hacia la izquierda", "categoria": "combate"},
      {"evento": "JumpLandEnd", "nombre": "Aterrizar", "categoria": "combate"},
      {"evento": "JumpLandDirectional", "nombre": "Aterrizar de lado", "categoria": "combate"},
      {"evento": "DragonMountExit", "nombre": "Bajar del dragón", "categoria": "combate"},
      {"evento": "Ground_Dismount_Dragon", "nombre": "Bajar del dragón en tierra", "categoria": "combate"},
      {"evento": "JumpFall", "nombre": "Caer", "categoria": "combate"},
      {"evento": "WeapOutRightReplaceForceEquip", "nombre": "Cambiar el arma de la derecha", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MC_WeapOutRightReplaceForceEquip", "nombre": "Cambiar el arma de la derecha (2)", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapOutLeftReplaceForceEquip", "nombre": "Cambiar el arma de la izquierda", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "ShoutSprintLongStart", "nombre": "Carrera del Torbellino, larga", "categoria": "combate"},
      {"evento": "ShoutSprintMediumStart", "nombre": "Carrera del Torbellino, media", "categoria": "combate"},
      {"evento": "ShoutSprintLongestStart", "nombre": "Carrera del Torbellino, muy larga", "categoria": "combate"},
      {"evento": "attackPowerStartH2HCombo", "nombre": "Combinación de puñetazos", "categoria": "combate"},
      {"evento": "RitualSpellOut", "nombre": "Cortar el hechizo ritual", "categoria": "combate"},
      {"evento": "pa_OffsetBoundStandingCut", "nombre": "Cortarle las ataduras a alguien (en pareja)", "categoria": "combate"},
      {"evento": "moveStop", "nombre": "Dejar de andar", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "blockStop", "nombre": "Dejar de bloquear", "categoria": "combate"},
      {"evento": "SprintStop", "nombre": "Dejar de correr", "categoria": "combate"},
      {"evento": "bleedOutStop", "nombre": "Dejar de desangrarse", "categoria": "combate"},
      {"evento": "turnStop", "nombre": "Dejar de girar", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SwimStop", "nombre": "Dejar de nadar", "categoria": "combate"},
      {"evento": "MountedSwimStop", "nombre": "Dejar de nadar montado", "categoria": "combate"},
      {"evento": "bleedOutStart", "nombre": "Desangrarse", "categoria": "combate"},
      {"evento": "WeapEquip", "nombre": "Desenvainar", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapSoloEquip", "nombre": "Desenvainar (sin nada más)", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "HorseExit", "nombre": "Desmontar del caballo", "categoria": "combate"},
      {"evento": "HorseExitSwim", "nombre": "Desmontar del caballo en el agua", "categoria": "combate"},
      {"evento": "bowAttackStart", "nombre": "Disparar el arco", "categoria": "combate"},
      {"evento": "crossbowAttackStart", "nombre": "Disparar la ballesta", "categoria": "combate"},
      {"evento": "crossbowDwarvenAttackStart", "nombre": "Disparar la ballesta mejorada", "categoria": "combate"},
      {"evento": "moveStart", "nombre": "Echar a andar", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SprintStart", "nombre": "Echar a correr", "categoria": "combate"},
      {"evento": "ExecutionNextClip", "nombre": "Ejecución: siguiente parte", "categoria": "combate"},
      {"evento": "shoutStart", "nombre": "Empezar un Grito", "categoria": "combate"},
      {"evento": "MC_shoutStart", "nombre": "Empezar un Grito (2)", "categoria": "combate"},
      {"evento": "NPCshoutStart", "nombre": "Empezar un Grito (3)", "categoria": "combate"},
      {"evento": "RitualSpellStart", "nombre": "Empezar un hechizo ritual", "categoria": "combate"},
      {"evento": "idleRitualSpellStart", "nombre": "Empezar un hechizo ritual (pose)", "categoria": "combate"},
      {"evento": "IdleCombatShieldStart", "nombre": "En guardia, con el escudo", "categoria": "combate"},
      {"evento": "IdleCombatStretchingStart", "nombre": "En guardia, estirándose", "categoria": "combate"},
      {"evento": "IdleCombatLookingAroundStart", "nombre": "En guardia, mirando alrededor", "categoria": "combate"},
      {"evento": "IdleCombatSpecialStart", "nombre": "En guardia, pose especial", "categoria": "combate"},
      {"evento": "IdleCombatWeaponCheckStart", "nombre": "En guardia, revisando el arma", "categoria": "combate"},
      {"evento": "blockHitStart", "nombre": "Encajar un golpe con el bloqueo", "categoria": "combate"},
      {"evento": "UnequipNoAnim", "nombre": "Envainar sin animación", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "FlinchStart", "nombre": "Estremecerse", "categoria": "combate"},
      {"evento": "NPC_TurnRight90", "nombre": "Girar 90 grados a la derecha", "categoria": "combate"},
      {"evento": "NPC_TurnToWalkRight90", "nombre": "Girar 90 grados y echar a andar", "categoria": "combate"},
      {"evento": "turnRight", "nombre": "Girar a la derecha", "categoria": "combate"},
      {"evento": "turnLeft", "nombre": "Girar a la izquierda", "categoria": "combate"},
      {"evento": "bashFail", "nombre": "Golpe de escudo fallido", "categoria": "combate"},
      {"evento": "BashFail", "nombre": "Golpe de escudo fallido (2)", "categoria": "combate"},
      {"evento": "bashPowerStart", "nombre": "Golpe de escudo potente", "categoria": "combate"},
      {"evento": "pa_KillingBlow", "nombre": "Golpe de gracia", "categoria": "combate"},
      {"evento": "StaffBashRelease", "nombre": "Golpear con el bastón", "categoria": "combate"},
      {"evento": "bashStart", "nombre": "Golpear con el escudo", "categoria": "combate"},
      {"evento": "shoutReleaseSlowTime", "nombre": "Grito: Tiempo Lento", "categoria": "combate"},
      {"evento": "torchUnequip", "nombre": "Guardar la antorcha", "categoria": "combate"},
      {"evento": "MLh_SpellAimedConcentrationStart", "nombre": "Hechizo de concentración, izquierda", "categoria": "combate"},
      {"evento": "MRh_Equipped_Event", "nombre": "Hechizo equipado en la derecha", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MLh_Equipped_Event", "nombre": "Hechizo equipado en la izquierda", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_SpellReady_Event", "nombre": "Hechizo listo en la derecha", "categoria": "combate"},
      {"evento": "MLh_SpellReady_Event", "nombre": "Hechizo listo en la izquierda", "categoria": "combate"},
      {"evento": "RitualSpellAimConcentrationStart", "nombre": "Hechizo ritual de concentración", "categoria": "combate"},
      {"evento": "MRh_SpellSelfStart", "nombre": "Hechizo sobre uno mismo, derecha", "categoria": "combate"},
      {"evento": "wardAbsorb", "nombre": "La protección absorbe un hechizo", "categoria": "combate"},
      {"evento": "MRh_WardStart", "nombre": "Levantar protección con la derecha", "categoria": "combate"},
      {"evento": "MLh_WardStart", "nombre": "Levantar protección con la izquierda", "categoria": "combate"},
      {"evento": "SneakStop", "nombre": "Levantarse de agacharse", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "HorseEnter", "nombre": "Montar a caballo", "categoria": "combate"},
      {"evento": "DragonMountEnter", "nombre": "Montar en el dragón", "categoria": "combate"},
      {"evento": "MountedSwimStart", "nombre": "Nadar montado", "categoria": "combate"},
      {"evento": "MagicForceEquipRight", "nombre": "Poner magia en la derecha", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicForceEquipLeft", "nombre": "Poner magia en la izquierda", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicWeap_ForceEquip", "nombre": "Poner magia y arma", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "blockStart", "nombre": "Ponerse a bloquear", "categoria": "combate"},
      {"evento": "SwimStart", "nombre": "Ponerse a nadar", "categoria": "combate"},
      {"evento": "IdleCombatStart", "nombre": "Postura de combate", "categoria": "combate"},
      {"evento": "blockAnticipateStart", "nombre": "Prepararse para bloquear", "categoria": "combate"},
      {"evento": "AttackStartH2HRight", "nombre": "Puñetazo con la derecha", "categoria": "combate"},
      {"evento": "AttackStartH2HLeft", "nombre": "Puñetazo con la izquierda", "categoria": "combate"},
      {"evento": "attackPowerStartForwardH2HRightHand", "nombre": "Puñetazo potente hacia delante, derecha", "categoria": "combate"},
      {"evento": "attackPowerStartForwardH2HLeftHand", "nombre": "Puñetazo potente hacia delante, izquierda", "categoria": "combate"},
      {"evento": "NPC_BumpFromFront", "nombre": "Que te empujen de frente", "categoria": "combate"},
      {"evento": "reloadStart", "nombre": "Recargar", "categoria": "combate"},
      {"evento": "pa_KillMoveJ", "nombre": "Remate (1)", "categoria": "combate"},
      {"evento": "pa_KillMoveC", "nombre": "Remate (10)", "categoria": "combate"},
      {"evento": "pa_KillMoveTrollA", "nombre": "Remate (2)", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCat", "nombre": "Remate (3)", "categoria": "combate"},
      {"evento": "pa_KillMoveGiantA", "nombre": "Remate (4)", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugrB", "nombre": "Remate (5)", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugr", "nombre": "Remate (6)", "categoria": "combate"},
      {"evento": "pa_KillMoveBearA", "nombre": "Remate (7)", "categoria": "combate"},
      {"evento": "pa_KillMoveF", "nombre": "Remate (8)", "categoria": "combate"},
      {"evento": "pa_KillMoveD", "nombre": "Remate (9)", "categoria": "combate"},
      {"evento": "pa_KillMoveShortD", "nombre": "Remate (corto) (1)", "categoria": "combate"},
      {"evento": "pa_KillMoveShortC", "nombre": "Remate (corto) (2)", "categoria": "combate"},
      {"evento": "pa_KillMoveShortB", "nombre": "Remate (corto) (3)", "categoria": "combate"},
      {"evento": "pa_KillMoveShortA", "nombre": "Remate (corto) (4)", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCatShortB", "nombre": "Remate (corto) (5)", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCatShortA", "nombre": "Remate (corto) (6)", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugrShortA", "nombre": "Remate (corto) (7)", "categoria": "combate"},
      {"evento": "pa_KillMoveH2HComboA", "nombre": "Remate a puñetazos", "categoria": "combate"},
      {"evento": "pa_KillMoveDualWieldA", "nombre": "Remate con dos armas", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDraugrA", "nombre": "Remate con un arma a dos manos (1)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMFalmerB", "nombre": "Remate con un arma a dos manos (10)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMFalmerA", "nombre": "Remate con un arma a dos manos (11)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMBearB", "nombre": "Remate con un arma a dos manos (12)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMBearA", "nombre": "Remate con un arma a dos manos (13)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSabreCatB", "nombre": "Remate con un arma a dos manos (14)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSabreCatA", "nombre": "Remate con un arma a dos manos (15)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMWolfB", "nombre": "Remate con un arma a dos manos (2)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMWolfA", "nombre": "Remate con un arma a dos manos (3)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMTrollB", "nombre": "Remate con un arma a dos manos (4)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMTrollA", "nombre": "Remate con un arma a dos manos (5)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSteamCenturionA", "nombre": "Remate con un arma a dos manos (6)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSprigganA", "nombre": "Remate con un arma a dos manos (7)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMHagravenA", "nombre": "Remate con un arma a dos manos (8)", "categoria": "combate"},
      {"evento": "pa_KillMove2HMGiantA", "nombre": "Remate con un arma a dos manos (9)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMWolfB", "nombre": "Remate con un arma de una mano (1)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMGiantBleedOutA", "nombre": "Remate con un arma de una mano (10)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMGiantB", "nombre": "Remate con un arma de una mano (11)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerC", "nombre": "Remate con un arma de una mano (12)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerB", "nombre": "Remate con un arma de una mano (13)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerA", "nombre": "Remate con un arma de una mano (14)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMBearB", "nombre": "Remate con un arma de una mano (15)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMWolfA", "nombre": "Remate con un arma de una mano (2)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMTrollB", "nombre": "Remate con un arma de una mano (3)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSteamCenturionB", "nombre": "Remate con un arma de una mano (4)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSteamCenturionA", "nombre": "Remate con un arma de una mano (5)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSprigganB", "nombre": "Remate con un arma de una mano (6)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSprigganA", "nombre": "Remate con un arma de una mano (7)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMHagravenB", "nombre": "Remate con un arma de una mano (8)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMHagravenA", "nombre": "Remate con un arma de una mano (9)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWWolfA", "nombre": "Remate con un arma pesada (1)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWTrollA", "nombre": "Remate con un arma pesada (2)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSabreCatA", "nombre": "Remate con un arma pesada (3)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWGiantA", "nombre": "Remate con un arma pesada (4)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWBearA", "nombre": "Remate con un arma pesada (5)", "categoria": "combate"},
      {"evento": "pa_2HWKillMoveA", "nombre": "Remate con un arma pesada (6)", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSprigganA", "nombre": "Remate con un arma pesada (7)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSpiderSmashA", "nombre": "Remate: aplastar con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove2HMStabA", "nombre": "Remate: apuñalar con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSpiderStabA", "nombre": "Remate: apuñalar con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove2HMChaurusFlyerStabDown", "nombre": "Remate: apuñalar hacia abajo con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove1HMBackStab", "nombre": "Remate: apuñalar por la espalda con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove1HMVBSlowBackStab", "nombre": "Remate: apuñalar por la espalda, despacio con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMoveDLC02RipHeartOut", "nombre": "Remate: arrancarle el corazón", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma pesada", "categoria": "combate"},
      {"evento": "pa_KillMoveDWDecap", "nombre": "Remate: decapitar con dos armas", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDecap", "nombre": "Remate: decapitar con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecap", "nombre": "Remate: decapitar con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecapKnife", "nombre": "Remate: degollar con el cuchillo con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove2HWChaurusFlyerPullDownSlash", "nombre": "Remate: derribar y rajar con arma pesada", "categoria": "combate"},
      {"evento": "pa_KillMoveH2HSlamA", "nombre": "Remate: estrellarlo contra el suelo a puñetazos", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSpiderSlamA", "nombre": "Remate: estrellarlo contra el suelo con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSpiderSlamA", "nombre": "Remate: estrellarlo contra el suelo con un arma pesada", "categoria": "combate"},
      {"evento": "pa_KillMove2HMVBBlockAndSlash", "nombre": "Remate: parar y rajar con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove2HWVBBackBreaker", "nombre": "Remate: partirle la espalda con un arma pesada", "categoria": "combate"},
      {"evento": "pa_KillMove1HMVBSoccerKick", "nombre": "Remate: patada con un arma de una mano (1)", "categoria": "combate"},
      {"evento": "pa_KillMove1HMChaurusFlyerKick", "nombre": "Remate: patada con un arma de una mano (2)", "categoria": "combate"},
      {"evento": "pa_KillMoveSneakBackA", "nombre": "Remate: por la espalda, a hurtadillas", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDragonRodeoStabShort", "nombre": "Remate: puñalada a lomos con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDragonRodeoSlash", "nombre": "Remate: tajo a lomos con un arma de una mano", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDragonRodeoSlash", "nombre": "Remate: tajo a lomos con un arma pesada", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDragonSlash", "nombre": "Remate: tajo con un arma a dos manos", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDragonSlash", "nombre": "Remate: tajo con un arma pesada", "categoria": "combate"},
      {"evento": "MT_BreathExhaleShort", "nombre": "Resoplar", "categoria": "combate"},
      {"evento": "CombatReady_BreathExhaleShort", "nombre": "Resoplar en guardia", "categoria": "combate"},
      {"evento": "recoilLargeStart", "nombre": "Retroceder de un golpetazo", "categoria": "combate"},
      {"evento": "recoilStart", "nombre": "Retroceder por el golpe", "categoria": "combate"},
      {"evento": "ShdEquip", "nombre": "Sacar el escudo", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "torchEquip", "nombre": "Sacar la antorcha", "categoria": "combate"},
      {"evento": "torchForceEquip", "nombre": "Sacar la antorcha a la fuerza", "categoria": "combate"},
      {"evento": "Magic_Equip", "nombre": "Sacar la magia", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "Magic_Solo_Equip", "nombre": "Sacar la magia (sin nada más)", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "JumpStandingStart", "nombre": "Saltar en el sitio", "categoria": "combate"},
      {"evento": "JumpDirectionalStart", "nombre": "Saltar hacia un lado", "categoria": "combate"},
      {"evento": "WardBreak", "nombre": "Se rompe la protección", "categoria": "combate"},
      {"evento": "attackRelease", "nombre": "Soltar el ataque", "categoria": "combate"},
      {"evento": "attackReleaseL", "nombre": "Soltar el ataque con la izquierda", "categoria": "combate"},
      {"evento": "bashRelease", "nombre": "Soltar el golpe de escudo", "categoria": "combate"},
      {"evento": "MRh_SpellRelease_Event", "nombre": "Soltar el hechizo con la derecha", "categoria": "combate"},
      {"evento": "MLh_SpellRelease_Event", "nombre": "Soltar el hechizo con la izquierda", "categoria": "combate"},
      {"evento": "MLH_SpellRelease_event", "nombre": "Soltar el hechizo con la izquierda (2)", "categoria": "combate"},
      {"evento": "idleRitualSpellRelease", "nombre": "Soltar el hechizo ritual (pose)", "categoria": "combate"},
      {"evento": "swimForceEquip", "nombre": "Soltar lo que llevas al nadar", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "pa_DLC1SeranaHoldsVyrthur", "nombre": "Sujetar a alguien", "categoria": "combate"},
      {"evento": "MRh_SpellTelekinesisStart", "nombre": "Telequinesis con la derecha", "categoria": "combate"},
      {"evento": "MLh_SpellTelekinesisStart", "nombre": "Telequinesis con la izquierda", "categoria": "combate"},
      {"evento": "bowEnd", "nombre": "Terminar con el arco", "categoria": "combate"},
      {"evento": "shoutStop", "nombre": "Terminar el Grito", "categoria": "combate"},
      {"evento": "staggerStart", "nombre": "Trastabillar", "categoria": "combate"},
      {"evento": "StaggerPlayer", "nombre": "Trastabillar (jugador)", "categoria": "combate"},
      {"evento": "MountedStaggerStart", "nombre": "Trastabillar montado", "categoria": "combate"},
      {"evento": "VampireFeedingBedRollRight", "nombre": "Alimentarse en el petate, por la derecha", "categoria": "comer"},
      {"evento": "VampireFeedingBedRollLeft", "nombre": "Alimentarse en el petate, por la izquierda", "categoria": "comer"},
      {"evento": "VampireFeedingBedRight", "nombre": "Alimentarse en la cama, por la derecha", "categoria": "comer"},
      {"evento": "VampireFeedingBedLeft", "nombre": "Alimentarse en la cama, por la izquierda", "categoria": "comer"},
      {"evento": "IdleDrink", "nombre": "Beber", "categoria": "comer", "destacada": true},
      {"evento": "IdleDrinkFromFountain", "nombre": "Beber de la fuente", "categoria": "comer"},
      {"evento": "idleDrinkingStandingStart", "nombre": "Beber de pie", "categoria": "comer", "destacada": true},
      {"evento": "idleBarDrinkingStart", "nombre": "Beber en la barra", "categoria": "comer"},
      {"evento": "IdleMQ201Drink", "nombre": "Beber en la fiesta", "categoria": "comer"},
      {"evento": "ChairVampireEatingStart", "nombre": "Beber sangre sentado", "categoria": "comer", "sentado": true},
      {"evento": "ChairDrinkingStart", "nombre": "Beber sentado", "categoria": "comer", "sentado": true},
      {"evento": "IdleDrinkPotion", "nombre": "Beberse una poción", "categoria": "comer"},
      {"evento": "IdleMQ201ToastStart", "nombre": "Brindar", "categoria": "comer"},
      {"evento": "idleEatingStandingStart_DLC1Vampire", "nombre": "Comer carne cruda de pie", "categoria": "comer"},
      {"evento": "ChairEatingStart_VampireMeat", "nombre": "Comer carne cruda sentado", "categoria": "comer", "sentado": true},
      {"evento": "idleEatingStandingStart", "nombre": "Comer de pie", "categoria": "comer", "destacada": true},
      {"evento": "ChairEatingStart", "nombre": "Comer sentado", "categoria": "comer", "sentado": true},
      {"evento": "DrunkStop", "nombre": "Dejar de hacer eses", "categoria": "comer"},
      {"evento": "IdleTablePassOutEnter", "nombre": "Desplomarse sobre la mesa", "categoria": "comer"},
      {"evento": "IdleCannibalFeedStanding", "nombre": "Devorar de pie", "categoria": "comer"},
      {"evento": "IdleCannibalFeedCrouching", "nombre": "Devorar en cuclillas", "categoria": "comer"},
      {"evento": "OffsetCarryMQ201DrinkTray", "nombre": "Llevar una bandeja de bebidas", "categoria": "comer", "andando": true},
      {"evento": "OffsetCarryMQ201DrinkR", "nombre": "Llevar una copa en la mano", "categoria": "comer", "andando": true},
      {"evento": "pa_VampireFeedStanding_Front", "nombre": "Morder el cuello de frente", "categoria": "comer"},
      {"evento": "pa_VampireFeedStanding_Back", "nombre": "Morder el cuello por la espalda", "categoria": "comer"},
      {"evento": "DrunkStart", "nombre": "Ponerse a hacer eses", "categoria": "comer"},
      {"evento": "IdleTableDrinkEnter", "nombre": "Sentarse a la mesa a beber", "categoria": "comer"},
      {"evento": "IdleTableDrinkAndMugEnter", "nombre": "Sentarse a la mesa con jarra y bebida", "categoria": "comer"},
      {"evento": "IdleTableMugEnter", "nombre": "Sentarse a la mesa con una jarra", "categoria": "comer"},
      {"evento": "IdleTG03UseMeadBarrel", "nombre": "Servirse del barril de hidromiel", "categoria": "comer"},
      {"evento": "IdleMQ201HoldingDrinkTray", "nombre": "Sostener una bandeja de bebidas", "categoria": "comer"},
      {"evento": "IdleEatSoup", "nombre": "Tomar sopa", "categoria": "comer", "sentado": true},
      {"evento": "ChairEatingSoupStart", "nombre": "Tomar sopa sentado", "categoria": "comer", "sentado": true},
      {"evento": "IdleFurnitureExit", "nombre": "Levantarse del mueble", "categoria": "control", "busqueda": "levantarse salir silla cama mueble"},
      {"evento": "IdleStop", "nombre": "Parar la animación", "categoria": "control"},
      {"evento": "IdleForceDefaultState", "nombre": "Parar y volver a la postura normal", "categoria": "control", "busqueda": "parar detener cancelar normal quieto", "destacada": true},
      {"evento": "OffsetStop", "nombre": "Soltar lo que lleva en las manos", "categoria": "control", "busqueda": "soltar dejar manos"},
      {"evento": "RF_OpenStart", "nombre": "Actitud: cercana", "categoria": "dialogo"},
      {"evento": "RF_GuardedStart", "nombre": "Actitud: distante", "categoria": "dialogo"},
      {"evento": "RF_PlayfulStart", "nombre": "Actitud: juguetona", "categoria": "dialogo"},
      {"evento": "RF_SeriousStart", "nombre": "Actitud: seria", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeOpen", "nombre": "Cambiar a actitud cercana", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeGuarded", "nombre": "Cambiar a actitud distante", "categoria": "dialogo"},
      {"evento": "RF_MoodChangePlayful", "nombre": "Cambiar a actitud juguetona", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeSerious", "nombre": "Cambiar a actitud seria", "categoria": "dialogo"},
      {"evento": "RF_OpenDismissive_In", "nombre": "Cercana: desdén", "categoria": "dialogo"},
      {"evento": "RF_OpenInterested_In", "nombre": "Cercana: interés", "categoria": "dialogo"},
      {"evento": "RF_OpenThrowHands_In", "nombre": "Cercana: manos al aire", "categoria": "dialogo"},
      {"evento": "RF_Shock_Open", "nombre": "Cercana: sobresalto", "categoria": "dialogo"},
      {"evento": "RF_OpenPleading_In", "nombre": "Cercana: súplica", "categoria": "dialogo"},
      {"evento": "RF_GuardedDismissive_In", "nombre": "Distante: desdén", "categoria": "dialogo"},
      {"evento": "RF_GuardedInterested_In", "nombre": "Distante: interés", "categoria": "dialogo"},
      {"evento": "RF_GuardedThrowHands_In", "nombre": "Distante: manos al aire", "categoria": "dialogo"},
      {"evento": "RF_Shock_Guarded", "nombre": "Distante: sobresalto", "categoria": "dialogo"},
      {"evento": "RF_GuardedPleading_In", "nombre": "Distante: súplica", "categoria": "dialogo"},
      {"evento": "PairEnd", "nombre": "Fin de la escena en pareja", "categoria": "dialogo"},
      {"evento": "IdleDialogueDefensiveHandGesture", "nombre": "Gesto a la defensiva", "categoria": "dialogo"},
      {"evento": "IdleDialogueWelcomeHandGesture", "nombre": "Gesto de bienvenida", "categoria": "dialogo"},
      {"evento": "IdleDialogueStart", "nombre": "Hablar", "categoria": "dialogo"},
      {"evento": "IdleDialogueMovingTalkA", "nombre": "Hablar andando (A)", "categoria": "dialogo", "andando": true},
      {"evento": "IdleDialogueMovingTalkB", "nombre": "Hablar andando (B)", "categoria": "dialogo", "andando": true},
      {"evento": "IdleDialogueMovingTalkC", "nombre": "Hablar andando (C)", "categoria": "dialogo", "andando": true},
      {"evento": "IdleDialogueMovingTalkD", "nombre": "Hablar andando (D)", "categoria": "dialogo", "andando": true},
      {"evento": "DialogueNeutral", "nombre": "Hablar con naturalidad", "categoria": "dialogo"},
      {"evento": "IdleDialogueAngryStart", "nombre": "Hablar enfadado", "categoria": "dialogo"},
      {"evento": "MotionDrivenDialogueAngry", "nombre": "Hablar enfadado mientras te mueves", "categoria": "dialogo", "andando": true},
      {"evento": "IdleDialogueExpressiveStart", "nombre": "Hablar gesticulando", "categoria": "dialogo"},
      {"evento": "MotionDrivenDialogueGeneric", "nombre": "Hablar mientras te mueves", "categoria": "dialogo", "andando": true},
      {"evento": "IdleSnowElfPrinceChairDialogue", "nombre": "Hablar sentado con gesto solemne", "categoria": "dialogo", "sentado": true},
      {"evento": "MotionDrivenDialogueNextClip", "nombre": "Hablar: cambiar de gesto", "categoria": "dialogo", "andando": true},
      {"evento": "RF_PlayfulDismissive_In", "nombre": "Juguetona: desdén", "categoria": "dialogo"},
      {"evento": "RF_PlayfulInterested_In", "nombre": "Juguetona: interés", "categoria": "dialogo"},
      {"evento": "RF_PlayfulThrowHands_In", "nombre": "Juguetona: manos al aire", "categoria": "dialogo"},
      {"evento": "RF_Shock_Playful", "nombre": "Juguetona: sobresalto", "categoria": "dialogo"},
      {"evento": "RF_PlayfulPleading_In", "nombre": "Juguetona: súplica", "categoria": "dialogo"},
      {"evento": "IdleDialogueHandOnChinGesture", "nombre": "Mano en la barbilla", "categoria": "dialogo"},
      {"evento": "RF_Talk_In", "nombre": "Ponerse a hablar", "categoria": "dialogo"},
      {"evento": "LooseDialogueResponseNegative", "nombre": "Responder que no", "categoria": "dialogo"},
      {"evento": "LooseDialogueResponsePositive", "nombre": "Responder que sí", "categoria": "dialogo"},
      {"evento": "RF_SeriousDismissive_In", "nombre": "Seria: desdén", "categoria": "dialogo"},
      {"evento": "RF_SeriousInterested_In", "nombre": "Seria: interés", "categoria": "dialogo"},
      {"evento": "RF_SeriousThrowHands_In", "nombre": "Seria: manos al aire", "categoria": "dialogo"},
      {"evento": "RF_Shock_Serious", "nombre": "Seria: sobresalto", "categoria": "dialogo"},
      {"evento": "RF_SeriousPleading_In", "nombre": "Seria: súplica", "categoria": "dialogo"},
      {"evento": "RF_Idle_Out", "nombre": "Volver a la actitud normal", "categoria": "dialogo"},
      {"evento": "IdleBedRightEnterStart", "nombre": "Acostarse por la derecha", "categoria": "dormir"},
      {"evento": "IdleBedLeftEnterStart", "nombre": "Acostarse por la izquierda", "categoria": "dormir", "destacada": true},
      {"evento": "IdleSleepNod", "nombre": "Dar cabezadas", "categoria": "dormir"},
      {"evento": "IdleBedExitStart", "nombre": "Levantarse de la cama", "categoria": "dormir"},
      {"evento": "Idle_1stPersonWoozyGetUpFromBed", "nombre": "Levantarse de la cama aturdido (1ª persona)", "categoria": "dormir"},
      {"evento": "IdleBedQuickExitStart", "nombre": "Levantarse de la cama, rápido", "categoria": "dormir"},
      {"evento": "IdleCoffinEnter", "nombre": "Meterse en el ataúd", "categoria": "dormir"},
      {"evento": "DLC01CoffinEnterInstant", "nombre": "Meterse en el ataúd (2)", "categoria": "dormir"},
      {"evento": "IdleCoffinVertEnter", "nombre": "Meterse en el ataúd de pie", "categoria": "dormir"},
      {"evento": "IdleCoffinHorzEnter", "nombre": "Meterse en el ataúd tumbado", "categoria": "dormir"},
      {"evento": "IdleBedRollFrontEnterStart", "nombre": "Meterse en el petate de frente", "categoria": "dormir"},
      {"evento": "IdleBedRollRightEnterStart", "nombre": "Meterse en el petate por la derecha", "categoria": "dormir"},
      {"evento": "IdleBedRollLeftEnterStart", "nombre": "Meterse en el petate por la izquierda", "categoria": "dormir"},
      {"evento": "IdleChildLayOnFloor", "nombre": "Tumbarse en el suelo", "categoria": "dormir"},
      {"evento": "pa_HugA", "nombre": "Abrazar a alguien", "categoria": "gestos"},
      {"evento": "IdleMT_DoorBang", "nombre": "Aporrear una puerta", "categoria": "gestos"},
      {"evento": "IdleKneelingEnter", "nombre": "Arrodillarse", "categoria": "gestos", "destacada": true},
      {"evento": "IdleKneeling", "nombre": "Arrodillarse junto a un cadáver", "categoria": "gestos"},
      {"evento": "IdleWallCornerPeekREnter", "nombre": "Asomarse por la esquina, a la derecha", "categoria": "gestos"},
      {"evento": "IdleWallCornerPeekLEnter", "nombre": "Asomarse por la esquina, a la izquierda", "categoria": "gestos"},
      {"evento": "idle_A_sway_fastTrans", "nombre": "Balancearse", "categoria": "gestos"},
      {"evento": "IdleChildTaunt1", "nombre": "Burlarse (1)", "categoria": "gestos"},
      {"evento": "IdleChildTaunt2", "nombre": "Burlarse (2)", "categoria": "gestos"},
      {"evento": "IdleChildTaunt3", "nombre": "Burlarse (3)", "categoria": "gestos"},
      {"evento": "IdleChildTaunt4", "nombre": "Burlarse (4)", "categoria": "gestos"},
      {"evento": "IdleWarmHands", "nombre": "Calentarse las manos", "categoria": "gestos"},
      {"evento": "IdleWarmHandsStanding", "nombre": "Calentarse las manos de pie", "categoria": "gestos", "destacada": true},
      {"evento": "IdleWarmHandsCrouched", "nombre": "Calentarse las manos en cuclillas", "categoria": "gestos"},
      {"evento": "IdleWarmArms", "nombre": "Calentarse los brazos", "categoria": "gestos"},
      {"evento": "idle_A_leg_shift", "nombre": "Cambiar el peso de pierna", "categoria": "gestos"},
      {"evento": "IdleValericaWalkForward", "nombre": "Caminar hacia delante", "categoria": "gestos", "andando": true},
      {"evento": "idle_A_left_longTrans", "nombre": "Cargar el peso a la izquierda", "categoria": "gestos"},
      {"evento": "OffsetArmsCrossedStart", "nombre": "Cruzarse de brazos", "categoria": "gestos", "destacada": true, "andando": true},
      {"evento": "IdleCiceroHappy", "nombre": "Dar saltos de alegría", "categoria": "gestos"},
      {"evento": "IdleChildCryingEnd", "nombre": "Dejar de llorar", "categoria": "gestos"},
      {"evento": "IdleCowering", "nombre": "Encogerse de miedo", "categoria": "gestos", "destacada": true},
      {"evento": "IdleCowerEnter", "nombre": "Encogerse de miedo (empezar)", "categoria": "gestos"},
      {"evento": "IdleHideREnter", "nombre": "Esconderse a la derecha", "categoria": "gestos"},
      {"evento": "idle_A_swat_flies", "nombre": "Espantar moscas", "categoria": "gestos"},
      {"evento": "idle_A_shoulders", "nombre": "Estirar los hombros", "categoria": "gestos"},
      {"evento": "idle_A_shouldersVar1", "nombre": "Estirar los hombros (2)", "categoria": "gestos"},
      {"evento": "IdleWalkingCameraEnd", "nombre": "Fin del paseo de cámara", "categoria": "gestos"},
      {"evento": "IdleCiceroAgitated", "nombre": "Gesticular alterado", "categoria": "gestos"},
      {"evento": "IdleHDRight", "nombre": "Gesto hacia la derecha (variante HD)", "categoria": "gestos"},
      {"evento": "IdleHHRight", "nombre": "Gesto hacia la derecha (variante HH)", "categoria": "gestos"},
      {"evento": "IdleTalkAndUseItem", "nombre": "Hablar manejando algo", "categoria": "gestos"},
      {"evento": "IdleComeThisWay", "nombre": "Hacer señas para que te sigan", "categoria": "gestos", "destacada": true},
      {"evento": "IdleGrave_01", "nombre": "Inclinar la cabeza ante una tumba", "categoria": "gestos"},
      {"evento": "IdleGrave_02", "nombre": "Inclinar la cabeza ante una tumba (2)", "categoria": "gestos"},
      {"evento": "IdleSilentBow", "nombre": "Inclinarse en silencio", "categoria": "gestos"},
      {"evento": "idleDisbelief01Start", "nombre": "Incredulidad", "categoria": "gestos"},
      {"evento": "idleDisbelief02Start", "nombre": "Incredulidad (2)", "categoria": "gestos"},
      {"evento": "idleFreaReactionStart", "nombre": "Incredulidad (3)", "categoria": "gestos"},
      {"evento": "IdleFreaReaction2Start", "nombre": "Incredulidad (4)", "categoria": "gestos"},
      {"evento": "IdleChildPlayDirt", "nombre": "Jugar con la tierra", "categoria": "gestos"},
      {"evento": "IdleChildPlayDoll", "nombre": "Jugar con una muñeca", "categoria": "gestos"},
      {"evento": "idle_A_soft_rightTrans", "nombre": "Ladearse a la derecha", "categoria": "gestos"},
      {"evento": "IdleCleanSword", "nombre": "Limpiar la espada", "categoria": "gestos"},
      {"evento": "IdleGetAttention", "nombre": "Llamar la atención", "categoria": "gestos"},
      {"evento": "IdleChildCryingStart", "nombre": "Llorar", "categoria": "gestos"},
      {"evento": "IdleHandsBehindBack", "nombre": "Manos a la espalda", "categoria": "gestos", "destacada": true},
      {"evento": "IdlePresentSkeletonKey", "nombre": "Mostrar la Llave Maestra", "categoria": "gestos"},
      {"evento": "IdleChildFidget", "nombre": "Moverse inquieto", "categoria": "gestos"},
      {"evento": "IdleNervous", "nombre": "Nerviosismo", "categoria": "gestos", "destacada": true},
      {"evento": "IdleLookFar", "nombre": "Otear el horizonte", "categoria": "gestos"},
      {"evento": "IdleWalkingCameraStart", "nombre": "Paseo de cámara", "categoria": "gestos"},
      {"evento": "IdleChildApologize", "nombre": "Pedir perdón", "categoria": "gestos"},
      {"evento": "idleFreaSorrowLoopEnter", "nombre": "Pena", "categoria": "gestos"},
      {"evento": "IdleSnapToAttention", "nombre": "Ponerse firme", "categoria": "gestos", "destacada": true},
      {"evento": "IdleAstridEnter", "nombre": "Pose de espera", "categoria": "gestos"},
      {"evento": "IdleStaticPoseAStart", "nombre": "Pose fija A", "categoria": "gestos"},
      {"evento": "IdleStaticPoseBStart", "nombre": "Pose fija B", "categoria": "gestos"},
      {"evento": "IdleStaticPoseCStart", "nombre": "Pose fija C", "categoria": "gestos"},
      {"evento": "IdlePlayer", "nombre": "Postura del jugador", "categoria": "gestos"},
      {"evento": "IdleChildWhineKick", "nombre": "Rabieta a patadas", "categoria": "gestos"},
      {"evento": "IdleChildWhineStompFeet", "nombre": "Rabieta pataleando", "categoria": "gestos"},
      {"evento": "idle_A_scratch_back", "nombre": "Rascarse la espalda", "categoria": "gestos"},
      {"evento": "IdleSurrender", "nombre": "Rendirse", "categoria": "gestos", "destacada": true},
      {"evento": "IdleLaugh", "nombre": "Reírse", "categoria": "gestos", "destacada": true},
      {"evento": "idle_A_shakeout", "nombre": "Sacudirse", "categoria": "gestos"},
      {"evento": "idleDisbelief01Exit", "nombre": "Salir de la incredulidad", "categoria": "gestos"},
      {"evento": "idleDisbelief02Exit", "nombre": "Salir de la incredulidad (2)", "categoria": "gestos"},
      {"evento": "idleFreaDisbeliefLoopStop", "nombre": "Salir de la incredulidad (3)", "categoria": "gestos"},
      {"evento": "IdleFreaDisbelief2LoopStop", "nombre": "Salir de la incredulidad (4)", "categoria": "gestos"},
      {"evento": "idleFreaSorrowExit", "nombre": "Salir de la pena", "categoria": "gestos"},
      {"evento": "IdleWave", "nombre": "Saludar con la mano", "categoria": "gestos", "destacada": true},
      {"evento": "IdleSalute", "nombre": "Saludo militar", "categoria": "gestos", "destacada": true},
      {"evento": "IdleWipeBrow", "nombre": "Secarse la frente", "categoria": "gestos"},
      {"evento": "IdlePointFar_01", "nombre": "Señalar a lo lejos", "categoria": "gestos", "destacada": true},
      {"evento": "IdlePointFar_02", "nombre": "Señalar a lo lejos (2)", "categoria": "gestos"},
      {"evento": "IdlePointClose", "nombre": "Señalar algo cerca", "categoria": "gestos"},
      {"evento": "idle_A_pull_pants", "nombre": "Subirse los pantalones", "categoria": "gestos"},
      {"evento": "idle_A_sigh_var1Trans", "nombre": "Suspirar", "categoria": "gestos"},
      {"evento": "idle_A_sigh_var2Trans", "nombre": "Suspirar (2)", "categoria": "gestos"},
      {"evento": "IdleChildShy", "nombre": "Timidez", "categoria": "gestos"},
      {"evento": "IdleNocturnal_LookRight", "nombre": "Volver la mirada a la derecha", "categoria": "gestos"},
      {"evento": "IdleNocturnal_LookLeft", "nombre": "Volver la mirada a la izquierda", "categoria": "gestos"},
      {"evento": "IdleBracedPain", "nombre": "Aguantar el dolor", "categoria": "herido"},
      {"evento": "IdlePrisonerBeat", "nombre": "Apalear a un preso", "categoria": "herido"},
      {"evento": "TG05_StabPlayer", "nombre": "Apuñalar al jugador", "categoria": "herido"},
      {"evento": "IdleDLC02FallOnKnees", "nombre": "Caer de rodillas", "categoria": "herido"},
      {"evento": "BoundStandingCut", "nombre": "Cortar las ataduras", "categoria": "herido"},
      {"evento": "BoundStandingCutNPC", "nombre": "Cortarle las ataduras a alguien", "categoria": "herido"},
      {"evento": "IdleHandCut", "nombre": "Cortarse la mano", "categoria": "herido"},
      {"evento": "IdleBoundKneesEnterInstant", "nombre": "De rodillas y maniatado", "categoria": "herido"},
      {"evento": "IdleExecutionerChop_Player", "nombre": "Decapitar al jugador", "categoria": "herido"},
      {"evento": "IdleExecutionerChop", "nombre": "Decapitar con el hacha", "categoria": "herido"},
      {"evento": "IdleVampireFeastVictim", "nombre": "Dejarse morder el cuello", "categoria": "herido"},
      {"evento": "Ragdoll", "nombre": "Desplomarse como un muñeco", "categoria": "herido"},
      {"evento": "IdleWebThrashShort", "nombre": "Forcejear en la telaraña", "categoria": "herido"},
      {"evento": "IdleWebThrashShort2", "nombre": "Forcejear en la telaraña (2)", "categoria": "herido"},
      {"evento": "IdleExecutionGuardIdle", "nombre": "Guardia de la ejecución", "categoria": "herido"},
      {"evento": "IdleInjured", "nombre": "Herido", "categoria": "herido", "destacada": true},
      {"evento": "IdleWounded_01", "nombre": "Herido (1)", "categoria": "herido", "destacada": true},
      {"evento": "IdleWounded_02", "nombre": "Herido (2)", "categoria": "herido"},
      {"evento": "IdleWounded_03", "nombre": "Herido (3)", "categoria": "herido"},
      {"evento": "TG05_GetUp", "nombre": "Levantarse aturdido", "categoria": "herido"},
      {"evento": "GetUpBegin", "nombre": "Levantarse del suelo", "categoria": "herido"},
      {"evento": "OffsetBoundStandingStart", "nombre": "Maniatado de pie", "categoria": "herido", "andando": true},
      {"evento": "DeathAnim", "nombre": "Morir", "categoria": "herido"},
      {"evento": "IdleDLC02MiraakDeath", "nombre": "Morir despacio", "categoria": "herido"},
      {"evento": "MS12BedDeath", "nombre": "Morir en la cama", "categoria": "herido"},
      {"evento": "IdleSoupDeath", "nombre": "Morir sobre el plato", "categoria": "herido"},
      {"evento": "IdleCartPrisonerAExit", "nombre": "Preso A: bajarse del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerAIdle", "nombre": "Preso A: en el carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerASway", "nombre": "Preso A: vaivén del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBExit", "nombre": "Preso B: bajarse del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBIdle", "nombre": "Preso B: en el carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBSway", "nombre": "Preso B: vaivén del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCExit", "nombre": "Preso C: bajarse del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCIdle", "nombre": "Preso C: en el carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCSway", "nombre": "Preso C: vaivén del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDExit", "nombre": "Preso D: bajarse del carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDIdle", "nombre": "Preso D: en el carro", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDSway", "nombre": "Preso D: vaivén del carro", "categoria": "herido"},
      {"evento": "IdleWebEnterInstant", "nombre": "Quedar atrapado en la telaraña", "categoria": "herido"},
      {"evento": "TG05_KnockOut", "nombre": "Quedar inconsciente", "categoria": "herido"},
      {"evento": "IdleExecutionerAlduinReaction", "nombre": "Reaccionar con espanto", "categoria": "herido"},
      {"evento": "IdleExecutionerAlduinReactionDeath", "nombre": "Reaccionar con espanto y morir", "categoria": "herido"},
      {"evento": "IdleFurnitureExitTriggered", "nombre": "Salir del mueble (forzado)", "categoria": "herido"},
      {"evento": "IdleWebExit", "nombre": "Soltarse de la telaraña", "categoria": "herido"},
      {"evento": "IdleWebExitQuickTurn", "nombre": "Soltarse de la telaraña y girarse", "categoria": "herido"},
      {"evento": "IdleDLC02MiraakDeathFinish", "nombre": "Terminar de morir despacio", "categoria": "herido"},
      {"evento": "IdleUncontrollableCough", "nombre": "Tos incontrolable", "categoria": "herido"},
      {"evento": "IdleMQ203EsbernBookEnter", "nombre": "Consultar un libro", "categoria": "leer"},
      {"evento": "IdleStudy", "nombre": "Estudiar", "categoria": "leer", "destacada": true},
      {"evento": "IdleReadElderScroll", "nombre": "Leer el Pergamino Ancestral", "categoria": "leer"},
      {"evento": "IdleReadElderScroll3rdP", "nombre": "Leer el Pergamino Ancestral (3ª persona)", "categoria": "leer"},
      {"evento": "IdleReadElderScrollLonger", "nombre": "Leer el Pergamino Ancestral (largo)", "categoria": "leer"},
      {"evento": "ChairReadingStart", "nombre": "Leer sentado", "categoria": "leer", "sentado": true},
      {"evento": "ChairReadingIdles", "nombre": "Leer sentado: pasar páginas", "categoria": "leer", "sentado": true},
      {"evento": "IdleBook_Read", "nombre": "Leer un libro", "categoria": "leer", "destacada": true},
      {"evento": "IdleBook_ReadTG06", "nombre": "Leer un libro (traducción)", "categoria": "leer"},
      {"evento": "IdleNoteRead", "nombre": "Leer una nota", "categoria": "leer", "destacada": true},
      {"evento": "IdleMQ206FelldirShowScroll", "nombre": "Mostrar el pergamino", "categoria": "leer"},
      {"evento": "IdleTG06FlipPage", "nombre": "Pasar la página", "categoria": "leer"},
      {"evento": "IdleBook_PageTurn", "nombre": "Pasar páginas", "categoria": "leer"},
      {"evento": "IdleBook_OnePage", "nombre": "Pasar una página", "categoria": "leer"},
      {"evento": "IdleRFPickUpScroll", "nombre": "Recoger un pergamino", "categoria": "leer"},
      {"evento": "IdleReadElderScrollEnd", "nombre": "Terminar de leer el Pergamino Ancestral", "categoria": "leer"},
      {"evento": "IdleTG06TranslationEnter", "nombre": "Traducir un texto", "categoria": "leer"},
      {"evento": "IdleDLC2TentacleWarpBook", "nombre": "Abrir el libro que te transporta", "categoria": "magia"},
      {"evento": "IdleBloodPortalActivate", "nombre": "Activar el portal de sangre", "categoria": "magia"},
      {"evento": "IdleNocturnal_Rise", "nombre": "Alzarse", "categoria": "magia"},
      {"evento": "IdleTGFalmerStatueEnter", "nombre": "Ante una estatua", "categoria": "magia"},
      {"evento": "IdleNocturnalEnter", "nombre": "Aparecer", "categoria": "magia"},
      {"evento": "IdleBlessingKneelEnter", "nombre": "Arrodillarse a recibir la bendición", "categoria": "magia", "destacada": true},
      {"evento": "IdleAltarEnter", "nombre": "Arrodillarse en el altar", "categoria": "magia"},
      {"evento": "IdleT02AscendMale", "nombre": "Ascender (hombre)", "categoria": "magia"},
      {"evento": "IdleT02AscendFemale", "nombre": "Ascender (mujer)", "categoria": "magia"},
      {"evento": "IdleTelvanniTowerFloatUp", "nombre": "Ascender flotando", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceAscensionBurning", "nombre": "Ascensión en llamas", "categoria": "magia"},
      {"evento": "IdleDA02BoethiahPostEnter", "nombre": "Atado a un poste", "categoria": "magia"},
      {"evento": "IdleWalkThroughWallEnter", "nombre": "Atravesar la pared", "categoria": "magia"},
      {"evento": "IdleTG08_Phase1", "nombre": "Ceremonia del Gremio: fase 1", "categoria": "magia"},
      {"evento": "IdleTG08_Phase2", "nombre": "Ceremonia del Gremio: fase 2", "categoria": "magia"},
      {"evento": "IdleTG08_Phase3", "nombre": "Ceremonia del Gremio: fase 3", "categoria": "magia"},
      {"evento": "IdleTG08_Phase4", "nombre": "Ceremonia del Gremio: fase 4", "categoria": "magia"},
      {"evento": "IdleTG08_Phase5", "nombre": "Ceremonia del Gremio: fase 5", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony3Chest", "nombre": "Ceremonia: abrir el cofre", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony2Blessing", "nombre": "Ceremonia: bendecir", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony1Welcome", "nombre": "Ceremonia: dar la bienvenida", "categoria": "magia"},
      {"evento": "pa_WW_CutWrist", "nombre": "Cortarse la muñeca", "categoria": "magia"},
      {"evento": "IdleMesmerizeStop", "nombre": "Dejar de hipnotizar", "categoria": "magia"},
      {"evento": "IdleNocturnal_Exit", "nombre": "Desaparecer", "categoria": "magia"},
      {"evento": "IdleTelvanniTowerFloatDown", "nombre": "Descender flotando", "categoria": "magia"},
      {"evento": "IdleRitualStart", "nombre": "Empezar un ritual", "categoria": "magia"},
      {"evento": "IdleGreybeardWordTeach", "nombre": "Enseñar una Palabra", "categoria": "magia"},
      {"evento": "IdleDLC1BossExplosion1stP", "nombre": "Explosión (1ª persona)", "categoria": "magia"},
      {"evento": "pa_ExtractWerewolfSpirit", "nombre": "Extraer un espíritu", "categoria": "magia"},
      {"evento": "IdleMagic_01", "nombre": "Gesto de magia", "categoria": "magia"},
      {"evento": "IdleDLC02TentacleWordBurnBegin", "nombre": "Grabar la Palabra (empezar)", "categoria": "magia"},
      {"evento": "IdleDLC02TentacleWordBurnEnd", "nombre": "Grabar la Palabra (terminar)", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceBigSpell", "nombre": "Gran hechizo", "categoria": "magia"},
      {"evento": "IdleMesmerize", "nombre": "Hipnotizar", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceFireAndForget", "nombre": "Lanzar un hechizo sentado", "categoria": "magia"},
      {"evento": "IdleGreybeardMeditateEnter", "nombre": "Meditar", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleA", "nombre": "Pose solemne", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleB", "nombre": "Pose solemne (2)", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleAMirror", "nombre": "Pose solemne (reflejada)", "categoria": "magia"},
      {"evento": "IdlePray", "nombre": "Rezar", "categoria": "magia", "destacada": true},
      {"evento": "IdlePrayCrouchedEnter", "nombre": "Rezar en cuclillas", "categoria": "magia"},
      {"evento": "IdleBoyRitual", "nombre": "Ritual", "categoria": "magia"},
      {"evento": "IdleRitualSkull1", "nombre": "Ritual con la calavera (1)", "categoria": "magia"},
      {"evento": "IdleRitualSkull2", "nombre": "Ritual con la calavera (2)", "categoria": "magia"},
      {"evento": "IdleRitualSkull3", "nombre": "Ritual con la calavera (3)", "categoria": "magia"},
      {"evento": "IdleMQ206FelldirRitualEnter", "nombre": "Ritual con las manos en alto", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceBigSpellRelease", "nombre": "Soltar el gran hechizo", "categoria": "magia"},
      {"evento": "IdleWerewolfTransformation", "nombre": "Transformarse", "categoria": "magia"},
      {"evento": "IdleVampireLordTransformation", "nombre": "Transformarse (2)", "categoria": "magia"},
      {"evento": "IdleApplaud2", "nombre": "Aplaudir", "categoria": "musica", "destacada": true},
      {"evento": "IdleApplaud3", "nombre": "Aplaudir (2)", "categoria": "musica"},
      {"evento": "IdleApplaud4", "nombre": "Aplaudir (3)", "categoria": "musica"},
      {"evento": "IdleApplaud5", "nombre": "Aplaudir (4)", "categoria": "musica"},
      {"evento": "IdleApplaudSarcastic", "nombre": "Aplaudir con sorna", "categoria": "musica"},
      {"evento": "IdleCiceroDance1", "nombre": "Baile (1)", "categoria": "musica", "destacada": true},
      {"evento": "IdleCiceroDance2", "nombre": "Baile (2)", "categoria": "musica"},
      {"evento": "IdleCiceroDance3", "nombre": "Baile (3)", "categoria": "musica"},
      {"evento": "SpectatorClap", "nombre": "Público: aplaudir", "categoria": "musica"},
      {"evento": "SpectatorTalking", "nombre": "Público: cuchichear", "categoria": "musica"},
      {"evento": "SpectatorGawk", "nombre": "Público: quedarse boquiabierto", "categoria": "musica"},
      {"evento": "SpectatorCheer", "nombre": "Público: vitorear", "categoria": "musica"},
      {"evento": "IdleBlowHornStormcloak", "nombre": "Tocar el cuerno de los Capas de la Tormenta", "categoria": "musica"},
      {"evento": "IdleBlowHornImperial", "nombre": "Tocar el cuerno imperial", "categoria": "musica"},
      {"evento": "IdleLuteStart", "nombre": "Tocar el laúd", "categoria": "musica", "destacada": true},
      {"evento": "IdleDrumStart", "nombre": "Tocar el tambor", "categoria": "musica", "destacada": true},
      {"evento": "IdleFluteStart", "nombre": "Tocar la flauta", "categoria": "musica", "destacada": true},
      {"evento": "IdleCivilWarCheer", "nombre": "Vitorear", "categoria": "musica"},
      {"evento": "IdleActivateCoffinPuzzle", "nombre": "Accionar el cuenco del ataúd", "categoria": "oficios"},
      {"evento": "Lever_PlayerPush", "nombre": "Accionar una palanca", "categoria": "oficios"},
      {"evento": "IdleSharpeningWheelStart", "nombre": "Afilar en la muela", "categoria": "oficios"},
      {"evento": "IdleCartDriverExit", "nombre": "Bajarse del pescante", "categoria": "oficios"},
      {"evento": "idleLooseSweepingStart", "nombre": "Barrer", "categoria": "oficios", "destacada": true},
      {"evento": "IdleHoe", "nombre": "Cavar con la azada", "categoria": "oficios", "destacada": true},
      {"evento": "IdleChiselStandingEnter", "nombre": "Cincelar de pie", "categoria": "oficios"},
      {"evento": "IdleChiselKneelingEnter", "nombre": "Cincelar de rodillas", "categoria": "oficios"},
      {"evento": "IdleCraftingCookingPotTalkA", "nombre": "Cocinar y hablar (A)", "categoria": "oficios"},
      {"evento": "IdleCraftingCookingPotTalkB", "nombre": "Cocinar y hablar (B)", "categoria": "oficios"},
      {"evento": "IdleTake", "nombre": "Coger algo", "categoria": "oficios"},
      {"evento": "IdleWoodChopStart", "nombre": "Cortar leña", "categoria": "oficios", "destacada": true},
      {"evento": "IdleFeedChicken", "nombre": "Dar de comer a las gallinas", "categoria": "oficios"},
      {"evento": "IdlewoodputdownEnter", "nombre": "Dejar la leña", "categoria": "oficios"},
      {"evento": "IdleStonePutDownEnter", "nombre": "Dejar una piedra", "categoria": "oficios"},
      {"evento": "IdleCraftingCookingPotAddIngredient", "nombre": "Echar un ingrediente al puchero", "categoria": "oficios"},
      {"evento": "IdleLightSconce", "nombre": "Encender una antorcha de pared", "categoria": "oficios"},
      {"evento": "IdleGive", "nombre": "Entregar algo", "categoria": "oficios"},
      {"evento": "IdleGiveMQ105Horn", "nombre": "Entregar el cuerno", "categoria": "oficios"},
      {"evento": "IdleWriteTableStandingEnter", "nombre": "Escribir de pie en la mesa", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerEnter", "nombre": "Escribir en el registro", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerWrite", "nombre": "Escribir en el registro (escribiendo)", "categoria": "oficios"},
      {"evento": "IdleChairWrite", "nombre": "Escribir sentado", "categoria": "oficios", "sentado": true},
      {"evento": "IdleExamine", "nombre": "Examinar algo", "categoria": "oficios"},
      {"evento": "IdleLockPick", "nombre": "Forzar una cerradura", "categoria": "oficios"},
      {"evento": "IdleDLC02BoatRide", "nombre": "Ir en barca", "categoria": "oficios"},
      {"evento": "IdleWriteTableChairRightExit", "nombre": "Levantarse del escritorio por la derecha", "categoria": "oficios"},
      {"evento": "IdleWriteTableChairLeftExit", "nombre": "Levantarse del escritorio por la izquierda", "categoria": "oficios"},
      {"evento": "IdleBarCounterWipe", "nombre": "Limpiar la barra", "categoria": "oficios"},
      {"evento": "IdleCartDriverIdle", "nombre": "Llevar el carro", "categoria": "oficios", "andando": true},
      {"evento": "IdleCartDriverSway", "nombre": "Llevar el carro, con vaivén", "categoria": "oficios", "andando": true},
      {"evento": "OffsetFlowerBasketStart", "nombre": "Llevar el cesto de flores", "categoria": "oficios", "andando": true},
      {"evento": "OffsetCarryBasketStart", "nombre": "Llevar un cesto", "categoria": "oficios", "andando": true},
      {"evento": "OffsetCarryPotStart", "nombre": "Llevar un puchero", "categoria": "oficios", "andando": true},
      {"evento": "IdleDwemerExtractorEnter", "nombre": "Manejar un extractor", "categoria": "oficios"},
      {"evento": "IdlePickaxeEnter", "nombre": "Picar con el pico", "categoria": "oficios", "destacada": true},
      {"evento": "IdleWriteLedgerChargenEnter", "nombre": "Ponerse a escribir en el registro", "categoria": "oficios"},
      {"evento": "IdleCounterStart", "nombre": "Ponerse tras el mostrador", "categoria": "oficios"},
      {"evento": "IdleSearchingChest", "nombre": "Rebuscando en el cofre", "categoria": "oficios"},
      {"evento": "IdleSearchingTable", "nombre": "Rebuscando en la mesa", "categoria": "oficios"},
      {"evento": "IdleSearchTableEnter", "nombre": "Rebuscar en la mesa", "categoria": "oficios"},
      {"evento": "IdleSearchChestEnter", "nombre": "Rebuscar en un cofre", "categoria": "oficios"},
      {"evento": "IdleWayShrineWaterScoopEnter", "nombre": "Recoger agua del santuario", "categoria": "oficios"},
      {"evento": "IdleActivatePickUp", "nombre": "Recoger algo", "categoria": "oficios"},
      {"evento": "IdlePickup_Ground", "nombre": "Recoger algo del suelo", "categoria": "oficios"},
      {"evento": "OffsetCarryFlowerBasketPickStart", "nombre": "Recoger flores en el cesto", "categoria": "oficios", "andando": true},
      {"evento": "IdleWoodPickUpEnter", "nombre": "Recoger leña", "categoria": "oficios"},
      {"evento": "IdleStonePickUpEnter", "nombre": "Recoger una piedra", "categoria": "oficios"},
      {"evento": "IdleWriteTableChairRightEnter", "nombre": "Sentarse a escribir por la derecha", "categoria": "oficios"},
      {"evento": "IdleWriteTableChairLeftEnter", "nombre": "Sentarse a escribir por la izquierda", "categoria": "oficios"},
      {"evento": "IdleOffsetCarryPotServe", "nombre": "Servir del puchero", "categoria": "oficios", "andando": true},
      {"evento": "IdleCartTravelPlayerEnter", "nombre": "Subirse al carro", "categoria": "oficios"},
      {"evento": "IdleCartTravelDriverEnter", "nombre": "Subirse al pescante", "categoria": "oficios"},
      {"evento": "IdlePullChain", "nombre": "Tirar de la cadena", "categoria": "oficios"},
      {"evento": "IdleBlackSmithingEnterStart", "nombre": "Trabajar en la forja", "categoria": "oficios", "destacada": true},
      {"evento": "IdleSell", "nombre": "Vender algo", "categoria": "oficios"},
      {"evento": "IdleRailLeanEnter", "nombre": "Apoyarse en la baranda", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleBarCounterEnter", "nombre": "Apoyarse en la barra", "categoria": "sentarse"},
      {"evento": "IdleTableLeanPoint", "nombre": "Apoyarse en la mesa y señalar", "categoria": "sentarse"},
      {"evento": "IdleWallLeanStart", "nombre": "Apoyarse en la pared", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleRailLeanExit", "nombre": "Dejar de apoyarse en la baranda", "categoria": "sentarse"},
      {"evento": "IdleLounge_Exit", "nombre": "Dejar de repantigarse", "categoria": "sentarse"},
      {"evento": "IdleChairFrontExit", "nombre": "Levantarse de frente", "categoria": "sentarse"},
      {"evento": "IdleChairFrontQuickExit", "nombre": "Levantarse de frente, rápido", "categoria": "sentarse"},
      {"evento": "IdleTableBackExit", "nombre": "Levantarse de la mesa", "categoria": "sentarse"},
      {"evento": "IdleChairExitStart", "nombre": "Levantarse de la silla", "categoria": "sentarse"},
      {"evento": "IdleStoolBackExit", "nombre": "Levantarse del taburete", "categoria": "sentarse"},
      {"evento": "idleChairRightExit", "nombre": "Levantarse por la derecha", "categoria": "sentarse"},
      {"evento": "IdleChairRightQuickExit", "nombre": "Levantarse por la derecha, rápido", "categoria": "sentarse"},
      {"evento": "idleChairLeftExit", "nombre": "Levantarse por la izquierda", "categoria": "sentarse"},
      {"evento": "IdleChairLeftQuickExit", "nombre": "Levantarse por la izquierda, rápido", "categoria": "sentarse"},
      {"evento": "IdleLounge", "nombre": "Repantigarse", "categoria": "sentarse", "destacada": true},
      {"evento": "idleChairArmsCrossedVar1", "nombre": "Sentado, brazos cruzados", "categoria": "sentarse", "sentado": true},
      {"evento": "idleChairArmsCrossedVar2", "nombre": "Sentado, brazos cruzados (2)", "categoria": "sentarse", "sentado": true},
      {"evento": "idleChairShoulderFlex", "nombre": "Sentado, estirar los hombros", "categoria": "sentarse", "sentado": true},
      {"evento": "idleChairLookDown", "nombre": "Sentado, mirando al suelo", "categoria": "sentarse", "sentado": true},
      {"evento": "IdleChairVar1", "nombre": "Sentado, quieto", "categoria": "sentarse", "sentado": true},
      {"evento": "idleChairVar2", "nombre": "Sentado, quieto (2)", "categoria": "sentarse", "sentado": true},
      {"evento": "IdleChildLegsOutStart", "nombre": "Sentarse con las piernas estiradas", "categoria": "sentarse"},
      {"evento": "IdleChairFrontEnter", "nombre": "Sentarse de frente", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleChildSitOnKnees", "nombre": "Sentarse de rodillas", "categoria": "sentarse"},
      {"evento": "IdleStoolEnter", "nombre": "Sentarse en el taburete", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleJarlChairEnter", "nombre": "Sentarse en el trono del jarl", "categoria": "sentarse"},
      {"evento": "IdleChairRightEnter", "nombre": "Sentarse por la derecha", "categoria": "sentarse"},
      {"evento": "IdleChairLeftEnter", "nombre": "Sentarse por la izquierda", "categoria": "sentarse"},
      {"evento": "IdleWallSoldierEnter", "nombre": "Soldado apostado en la muralla", "categoria": "sentarse"}
    ]
  };
// <<< CATALOGO GENERADO <<<

  /**
   * Junta el catalogo generado con lo que anada el usuario en los ajustes.
   *
   * Las del usuario van primero en caso de repetirse el evento: asi se puede
   * corregir el nombre o la categoria de una animacion vanilla sin regenerar
   * el catalogo. Las que no traigan categoria caen en "mods", que se crea sola
   * para que se vean juntas y se distingan de las del juego base.
   */
  function mezclarCatalogo() {
    var propias = [];
    try { propias = ajustes.animaciones || []; } catch (e) { propias = []; }

    var categorias = (CATALOGO.categorias || []).slice();
    var animaciones = [];
    var vistas = {};

    function anadir(ficha, deMod) {
      if (!ficha || !ficha.evento) return;              // sin evento no sirve
      if (vistas[ficha.evento]) return;                 // ya la tenemos
      vistas[ficha.evento] = true;
      animaciones.push({
        evento: String(ficha.evento),
        nombre: String(ficha.nombre || ficha.evento),
        categoria: String(ficha.categoria || (deMod ? 'mods' : 'otras')),
        busqueda: String(ficha.busqueda || ''),
        destacada: !!ficha.destacada,
        andando: !!ficha.andando,
        sentado: !!ficha.sentado,
        sincroniza: ficha.sincroniza === false ? false : true,
        motivo: ficha.motivo || '',
        origen: ficha.origen || (deMod ? 'mod' : 'vanilla')
      });
    }

    for (var i = 0; i < propias.length; i++) anadir(propias[i], true);
    var base = CATALOGO.animaciones || [];
    for (var j = 0; j < base.length; j++) anadir(base[j], false);

    // Una categoria por cada clave que haya salido y no estuviera declarada.
    var declaradas = {};
    for (var k = 0; k < categorias.length; k++) declaradas[categorias[k].clave] = true;
    for (var m = 0; m < animaciones.length; m++) {
      var c = animaciones[m].categoria;
      if (!declaradas[c]) {
        declaradas[c] = true;
        categorias.push({
          clave: c,
          nombre: c === 'mods' ? 'De otros mods' : (c.charAt(0).toUpperCase() + c.slice(1)),
          busqueda: ''
        });
      }
    }

    return { version: CATALOGO.version || 1, categorias: categorias,
             animaciones: animaciones };
  }

  var catalogo = mezclarCatalogo();

  /* =======================================================================
   * LOS FAVORITOS
   * =======================================================================
   *
   * Donde se guardan, y por que ahi
   *
   *   Lo evidente seria localStorage, que es lo que usaria cualquier pagina
   *   web. Pero esta pagina la dibuja el navegador que SkyrimPlatform monta
   *   encima del juego, y ese no garantiza que su almacenamiento sobreviva a
   *   cerrar Skyrim. Unos favoritos que se borran cada vez que cierras el
   *   juego no son favoritos.
   *
   *   Asi que se guardan en un archivo de verdad, con las dos funciones que
   *   SkyrimPlatform da para eso y que el propio cliente de SkyMP usa para
   *   recordar tu sesion:
   *
   *       sp.writePlugin(nombre, contenido, "PluginsNoLoad")
   *       sp.getPluginSourceCode(nombre, "PluginsNoLoad")
   *
   *   PluginsNoLoad es una carpeta de la que SkyrimPlatform NO carga nada: es
   *   su sitio para datos. El archivo empieza por // para que siga siendo
   *   JavaScript valido, que es el mismo truco que hace SkyMP.
   *
   * El plugin es el que manda: la pagina pinta las estrellas con lo que se le
   * pasa, y cuando pulsas una avisa. Aqui se apunta y se guarda.
   */
  var ARCHIVO_FAVORITOS = 'animplayer-favoritos';
  var favoritos = {};          // evento -> true

  function cargarFavoritos() {
    try {
      var crudo = sp.getPluginSourceCode(ARCHIVO_FAVORITOS, 'PluginsNoLoad');
      if (!crudo) return;
      var lista = JSON.parse(crudo.slice(2));      // se salta el // del principio
      if (!lista || !lista.length) return;
      for (var i = 0; i < lista.length; i++) favoritos[lista[i]] = true;
      apuntar(lista.length + ' favoritos recuperados');
    } catch (e) {
      // Sin archivo todavia, o escrito a mano y roto: se empieza de cero.
      apuntar('no habia favoritos guardados (' + e + ')');
    }
  }

  function guardarFavoritos() {
    try {
      sp.writePlugin(ARCHIVO_FAVORITOS, '//' + JSON.stringify(listaFavoritos()),
                     'PluginsNoLoad');
    } catch (e) {
      apuntar('no se pudieron guardar los favoritos: ' + e);
    }
  }

  function listaFavoritos() {
    var fuera = [];
    for (var evento in favoritos) {
      if (favoritos[evento]) fuera.push(evento);
    }
    return fuera;
  }

  /** Pone o quita un favorito y lo guarda. Devuelve como ha quedado. */
  function marcarFavorito(evento, activo) {
    if (!evento) return false;
    if (activo) favoritos[evento] = true;
    else delete favoritos[evento];
    guardarFavoritos();
    return !!favoritos[evento];
  }

  cargarFavoritos();

  /* Dos indices sobre el catalogo, para que la puerta de la capa 6 pueda
     responder deprisa a "existe este evento?" y "buscame algo que suene a
     laud". Se rehacen si otro mod anade animaciones en caliente. */
  var porEvento = {};

  /* Las mismas palabras que usa el panel, y de la misma forma: nombre, id (el
     id entero y partido por sus mayusculas) y lo extra que traiga. Con un
     espacio delante, para poder buscar por principio de palabra. */
  function palabrasDe(a) {
    var partido = String(a.evento)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-]+/g, ' ');
    return ' ' + sinAcentos(a.nombre + ' ' + a.evento + ' ' + partido + ' ' +
                            (a.busqueda || '') +
                            (a.andando ? ' andando caminar andar' : '') +
                            (a.sentado ? ' sentado silla' : ''));
  }

  function reconstruirIndice() {
    porEvento = {};
    for (var i = 0; i < catalogo.animaciones.length; i++) {
      var a = catalogo.animaciones[i];
      porEvento[a.evento] = a;
      a._busca = palabrasDe(a);
    }
  }

  /** Minusculas y sin acentos, para buscar como se escribe de verdad. */
  function sinAcentos(t) {
    return String(t || '').toLowerCase()
      .replace(/\u00e1|\u00e0|\u00e4/g, 'a')
      .replace(/\u00e9|\u00e8|\u00eb/g, 'e')
      .replace(/\u00ed|\u00ec|\u00ef/g, 'i')
      .replace(/\u00f3|\u00f2|\u00f6/g, 'o')
      .replace(/\u00fa|\u00f9|\u00fc/g, 'u')
      .replace(/\u00f1/g, 'n');
  }

  reconstruirIndice();

  /* =======================================================================
   * CAPA 2 — EL REPRODUCTOR
   * =======================================================================
   *
   * Lo unico de todo el archivo que habla con el juego. Si algun dia cambia la
   * forma de reproducir animaciones, se cambia aqui y en ningun otro sitio.
   *
   * Todo entra y sale en forma de PETICION, un objeto plano:
   *
   *     {
   *       evento: "IdleWave",     nombre del evento de animacion
   *       quien:  0x14,           formID de quien la hace (0x14 es el jugador)
   *       origen: "interfaz"      quien la pidio: interfaz | tecla | servidor
   *     }
   *
   * Es un objeto plano y serializable a proposito: es exactamente lo que se
   * mandara por la red el dia que las animaciones las reparta el servidor.
   * ======================================================================= */

  var FORMID_JUGADOR = 0x14;

  /* TODO lo que este mod le manda al grafo de animacion pasa por aqui.
   *
   * Hace falta para distinguir lo nuestro de lo que hace el juego por su
   * cuenta: el enganche del final del archivo se dispara con los dos, y sin
   * esta marca no habria forma de saber cual es cual —daria por terminada la
   * animacion en el mismo instante de lanzarla—.
   *
   * Se marca de dos maneras porque una sola no basta:
   *
   *   - la bandera, para cuando el enganche salta dentro de la llamada (que es
   *     lo que hace SkyrimPlatform);
   *   - la lista de lo mandado hace un momento, por si saltara despues. Cuesta
   *     nada y quita de encima el tener que fiarse de cuando salta.
   */
  var mandandoNosotros = false;
  var mandadoHaceNada = [];

  function enviarAlGrafo(actor, evento) {
    mandadoHaceNada.push({ evento: evento, cuando: Date.now() });
    if (mandadoHaceNada.length > 12) mandadoHaceNada.shift();
    mandandoNosotros = true;
    try {
      sp.Debug.sendAnimationEvent(actor, evento);
    } finally {
      mandandoNosotros = false;
    }
  }

  /** Si este evento lo acabamos de mandar nosotros. Lo gasta al encontrarlo. */
  function loMandamosNosotros(evento) {
    var limite = Date.now() - 1000;
    for (var i = mandadoHaceNada.length - 1; i >= 0; i--) {
      if (mandadoHaceNada[i].cuando < limite) continue;
      if (mandadoHaceNada[i].evento !== evento) continue;
      mandadoHaceNada.splice(i, 1);
      return true;
    }
    return false;
  }

  var Reproductor = {

    /**
     * Devuelve el actor sobre el que actuar, o null si no se puede.
     *
     * Para el jugador se usa Game.getPlayer(), que es lo fiable; para
     * cualquier otro, Game.getFormEx con su formID. Ese segundo camino hoy no
     * lo usa nadie: existe para cuando el servidor mande animaciones de otros
     * jugadores y haya que aplicarlas sobre su actor.
     */
    actorDe: function (peticion) {
      try {
        var quien = (peticion && peticion.quien) || FORMID_JUGADOR;
        if (quien === FORMID_JUGADOR) return sp.Game.getPlayer();
        return sp.Actor.from(sp.Game.getFormEx(quien));
      } catch (e) {
        apuntar('no se pudo resolver el actor: ' + e);
        return null;
      }
    },

    /**
     * Reproduce una animacion. Devuelve true si se mando al juego.
     *
     * OJO: tiene que llamarse desde un contexto nativo valido, o sea desde un
     * "update" o un "tick", NUNCA desde el callback de un mensaje del
     * navegador. De eso se encarga la cola (ver encolar).
     */
    reproducir: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;

      /* En primera persona las poses no se ven: el cuerpo no se dibuja. Pero
         esto no se hace en las repeticiones del bucle: si no, cada tres
         segundos te sacaria de primera persona y no podrias volver mientras
         dure el bucle. Se decide una vez, al pedirla. Lo mismo con el arma. */
      // El arma ya se ha mirado antes de llegar aqui (ver pedirAnimacion).
      if (peticion.origen !== 'bucle' && TERCERA_PERSONA) {
        Reproductor.aTerceraPersona();
      }
      return Reproductor.mandar(peticion);
    },

    /**
     * Devuelve al personaje a su postura normal.
     *
     * Se mandan tres eventos, y en este orden, porque hacen cosas distintas y
     * cada uno arregla lo que el anterior no toca:
     *
     *   OffsetStop            suelta lo que la animacion te haya puesto en las
     *                         manos. Hay diez que sacan un trasto —un cesto,
     *                         un puchero, una bandeja— y ese trasto no es un
     *                         objeto del inventario: es parte del estado del
     *                         grafo de animacion, y sin esto se queda pegado a
     *                         las manos aunque la pose termine.
     *   IdleFurnitureExit     saca de una silla o una cama. Si no estas en
     *                         una, no hace nada.
     *   IdleForceDefaultState corta la pose y vuelve al estado normal.
     *
     * El orden importa: primero suelta, luego levanta, luego endereza. Con
     * solo el ultimo te quedas de pie dentro de la silla y con el puchero.
     */
    parar: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;
      // Por si el bloqueo del arma se quedo puesto: soltarlo no cuesta nada.
      Reproductor.soltarElArma(actor);
      try {
        enviarAlGrafo(actor, 'OffsetStop');
        enviarAlGrafo(actor, 'IdleFurnitureExit');
        enviarAlGrafo(actor, 'IdleForceDefaultState');
        apuntar('animacion parada');
        return true;
      } catch (e) {
        apuntar('fallo al parar: ' + e);
        return false;
      }
    },

    /**
     * Desatasca al personaje cuando una animacion se queda colgada.
     *
     * "Detener" manda los dos eventos de siempre y con eso basta el 95% de las
     * veces. Esto es para el otro 5%: te quedas clavado en una pose, sin poder
     * moverte, o —la peor— atravesando las paredes.
     *
     * Lo de las paredes no es mala suerte: SkyMP TE QUITA LA COLISION al
     * sentarte (lo hace en su applyAnimation, con setCollision false para las
     * animaciones de silla) y te la devuelve al levantarte. Si esa segunda
     * parte no llega —porque la animacion se corto, porque cambiaste de zona a
     * medias— te quedas sin colision y no hay forma de recuperarla desde el
     * juego. De ahi que este boton exista.
     *
     * Va de lo suave a lo bruto, y cada paso en su propio try: si uno falla,
     * los demas tienen que hacerse igual.
     */
    reiniciar: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;
      var hechos = [];

      function intentar(que, hacer) {
        try { hacer(); hechos.push(que); } catch (e) { apuntar('reinicio, ' + que + ': ' + e); }
      }

      // 1. Soltar lo que lleve en las manos, salir del mueble y enderezarse.
      intentar('animacion', function () {
        enviarAlGrafo(actor, 'OffsetStop');
        enviarAlGrafo(actor, 'IdleFurnitureExit');
        enviarAlGrafo(actor, 'IdleForceDefaultState');
        enviarAlGrafo(actor, 'IdleStopInstant');
      });

      // 2. Soltar el bloqueo del arma, que si no no se puede desenfundar.
      intentar('arma', function () { Reproductor.soltarElArma(actor); });

      // 3. Que no se quede clavado en el sitio.
      intentar('movimiento', function () { actor.setDontMove(false); });

      // 3. Devolver TODOS los controles, no solo los que quitamos nosotros:
      //    si se quedaron quitados por otra cosa, aqui se arregla igual.
      intentar('controles', function () {
        sp.Game.enablePlayerControls(true, true, true, true, true, true, true, true, 0);
      });

      // 4. La colision. Esta es la que de verdad hacia falta.
      intentar('colision', function () {
        sp.setCollision(actor.getFormID(), true);
      });

      // 5. Y el remedio de toda la vida: moverse a uno mismo. No te cambia de
      //    sitio, pero hace que el juego vuelva a cargar el personaje, que es
      //    lo que saca de casi cualquier atasco. Se puede quitar en los
      //    ajustes por si en algun servidor sienta mal.
      if (RECARGAR_AL_REINICIAR) {
        intentar('recarga', function () { actor.moveTo(actor, 0, 0, 0, true); });
      }

      apuntar('reinicio: ' + hechos.join(', '));
      return true;
    },

    /** Manda el evento al juego y ya. Sin preparativos de ningun tipo. */
    mandar: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;
      try {
        enviarAlGrafo(actor, peticion.evento);
        if (peticion.origen !== 'bucle') {
          apuntar('animacion ' + peticion.evento + ' (' + (peticion.origen || '?') + ')');
        }
        return true;
      } catch (e) {
        apuntar('fallo al reproducir ' + peticion.evento + ': ' + e);
        return false;
      }
    },

    /**
     * Deja de forzar el estado del arma, si alguien lo dejo forzado.
     *
     * Este mod no toca el arma para nada, pero otra cosa puede haberla dejado
     * bloqueada: SkyMP usa setWeaponDrawnMode a todas horas para pintar a los
     * demas jugadores, y si se queda puesto sobre tu personaje te quedas sin
     * poder desenfundar. Cuesta nada y quita un atasco muy raro de encontrar.
     */
    soltarElArma: function (actor) {
      try {
        sp.TESModPlatform.setWeaponDrawnMode(actor, -1);
      } catch (e) { /* si no hay TESModPlatform, no habia nada que soltar */ }
    },

    /**
     * Si el personaje esta metido en un mueble (silla, banco, cama...).
     *
     * getFurnitureReference devuelve el mueble o nada. Es lo que usa el propio
     * cliente de SkyMP para lo mismo, asi que es de fiar.
     */
    enUnMueble: function (peticion) {
      try {
        var actor = Reproductor.actorDe(peticion);
        return !!(actor && actor.getFurnitureReference());
      } catch (e) {
        return false;
      }
    },

    aTerceraPersona: function () {
      try {
        // getCameraState: 0 es primera persona. Si la llamada no existe o
        // falla, se pasa a tercera igualmente, que no molesta.
        var estado = null;
        try { estado = sp.Game.getCameraState(); } catch (e) { estado = null; }
        if (estado === null || estado === 0) sp.Game.forceThirdPerson();
      } catch (e) { /* si no se puede, la animacion se manda igual */ }
    }
  };

  /**
   * El bucle.
   *
   * Skyrim no dice cuanto dura una animacion ni avisa de que ha terminado: la
   * mandas y ya. No hay forma de preguntarlo. Asi que repetir en bucle es
   * exactamente eso, volver a mandar el mismo evento cada cierto tiempo.
   *
   * El intervalo se puede cambiar en los ajustes (intervaloBucle). Tres
   * segundos va bien para la mayoria: los gestos duran menos y se reencadenan,
   * y las poses que ya se repiten solas no se enteran de que se les vuelve a
   * mandar lo mismo.
   *
   * Vive fuera del panel a proposito: si cierras el panel, el bucle sigue. Se
   * para con el boton de parar, o eligiendo otra animacion sin el bucle puesto.
   */
  var Bucle = {
    peticion: null,
    desde: 0,

    activo: function () { return !!Bucle.peticion; },

    poner: function (peticion) {
      Bucle.peticion = peticion;
      Bucle.desde = Date.now();
      apuntar('bucle puesto en ' + peticion.evento);
    },

    quitar: function () {
      if (!Bucle.peticion) return;
      apuntar('bucle quitado');
      Bucle.peticion = null;
    },

    /* Se llama en cada update. Tiene que ser barato cuando no hay bucle, que
       es el 99% del tiempo: una comparacion y fuera. */
    latido: function () {
      if (!Bucle.peticion) return;
      if (Date.now() - Bucle.desde < INTERVALO_BUCLE) return;
      Bucle.desde = Date.now();
      pedirAnimacion({
        evento: Bucle.peticion.evento,
        quien: Bucle.peticion.quien,
        origen: 'bucle'
      });
    }
  };

  /* =======================================================================
   * CAPA 3 — EL TRANSPORTE
   * =======================================================================
   *
   * Una peticion de animacion puede ir por dos caminos:
   *
   *   "local"     Se reproduce aqui mismo. Los demas jugadores la ven igual,
   *               porque SkyMP engancha sendAnimationEvent, ve el evento y lo
   *               reenvia al servidor por su cuenta. Es el camino recomendado
   *               y el que viene puesto.
   *
   *   "servidor"  Ademas de reproducirla, se avisa al servidor por HTTP. Esto
   *               esta aqui para el dia en que el servidor quiera decidir el
   *               las animaciones (validar, limitar por rol, reproducirlas en
   *               NPC, encadenar poses de dos personas...). Con la URL vacia no
   *               hace nada, que es como viene.
   *
   * La interfaz nunca llama al reproductor: llama a pedirAnimacion. Ese es el
   * punto por el que pasa TODO, y por tanto el unico sitio que habria que
   * tocar para cambiar de camino.
   * ======================================================================= */

  var Transportes = {

    local: function (peticion) {
      return Reproductor.reproducir(peticion);
    },

    servidor: function (peticion) {
      /* Con soloServidor puesto no se reproduce nada aqui: se avisa y se espera
         a que el servidor lo mande de vuelta. Sirve para que el servidor pueda
         decir que no (por rol, por zona, por lo que sea) y que no se vea la
         animacion un instante antes de que la corte. Por defecto esta quitado,
         porque sin servidor que responda no pasaria nada nunca. */
      var soloAlla = !!(SERVIDOR && SERVIDOR.soloServidor);
      var hecho = soloAlla ? true : Reproductor.reproducir(peticion);
      var url = SERVIDOR && SERVIDOR.url;
      if (!url) return hecho;             // sin URL configurada no hay a quien avisar
      try {
        // Se corta la direccion en origen + camino porque HttpClient de
        // SkyrimPlatform se construye con el origen y pide el camino aparte.
        var corte = url.indexOf('/', url.indexOf('://') + 3);
        var origen = corte === -1 ? url : url.slice(0, corte);
        var camino = corte === -1 ? '/' : url.slice(corte);
        var cliente = new sp.HttpClient(origen);
        cliente.post(camino, {
          body: JSON.stringify(peticion),
          contentType: 'application/json'
        });
      } catch (e) {
        apuntar('no se pudo avisar al servidor: ' + e);
      }
      return hecho;
    }
  };

  /* La peticion que espera a que termine la parada de la anterior, o null. */
  var esperandoParaCambiar = null;

  /** Manda la que estaba esperando, si ya le toca. */
  function vigilarElCambio() {
    if (!esperandoParaCambiar) return;
    if (Date.now() < esperandoParaCambiar.cuando) return;
    var espera = esperandoParaCambiar;
    esperandoParaCambiar = null;
    lanzar(espera.peticion);
  }

  /* Lo que se esta reproduciendo ahora mismo, o null. Hace falta para dos
     cosas: para quitar la de antes al pedir otra, y para que pedir la misma la
     pare. */
  var enMarcha = null;
  /* Y desde cuando. Es lo unico que hay para saber cuanto lleva puesta: el
     juego no dice lo que dura una animacion ni avisa de que ha terminado. */
  var enMarchaDesde = 0;

  /** Manda la peticion por el transporte que toque y avisa a quien escuche. */
  function lanzar(peticion) {
    var llevar = Transportes[TRANSPORTE] || Transportes.local;
    var hecho = llevar(peticion);
    if (hecho) {
      enMarcha = peticion.evento;
      enMarchaDesde = Date.now();
      avisarA(observadoresReproducir, peticion);
    }
    return hecho;
  }

  /**
   * LA PUERTA UNICA. Todo lo que quiera una animacion pasa por aqui.
   *
   * Una detras de otra, nunca dos a la vez:
   *
   *   - pedir la que YA esta sonando la para. Es lo que espera cualquiera que
   *     vuelva a pulsar lo mismo.
   *   - pedir otra distinta quita antes la de ahora. Sin esto, pedir "Rezar"
   *     sentado en una silla te dejaba rezando y sentado.
   *
   * La nueva se manda en el cuadro siguiente, no justo detras del corte. Son
   * dieciseis milisegundos que no se notan, y evita que el grafo de animacion
   * reciba el corte y la nueva en el mismo suspiro y se quede con el corte.
   *
   * Las vueltas del bucle no entran en nada de esto: son la MISMA animacion
   * repitiendose, asi que ni se para ni se releva.
   */
  function pedirAnimacion(peticion) {
    var limpia = {
      evento: String((peticion && peticion.evento) || ''),
      quien: (peticion && peticion.quien) || FORMID_JUGADOR,
      origen: (peticion && peticion.origen) || 'desconocido'
    };
    if (!limpia.evento) return false;

    if (limpia.origen !== 'bucle') {
      if (enMarcha === limpia.evento) {
        pedirParar(limpia.origen);
        return true;
      }
      /* Si lo que se pide es una pose de las que se hacen SENTADO y ya estas
         sentado, no se para nada: pararlo mandaria IdleFurnitureExit y te
         levantaria, y entonces la pose ya no tendria sobre que montarse. Va
         directa y sin espera. */
      var ficha = porEvento[limpia.evento];
      if (ficha && ficha.sentado && Reproductor.enUnMueble(limpia)) {
        esperandoParaCambiar = null;
        return lanzar(limpia);
      }

      return relevarYLanzar(limpia);
    }

    return lanzar(limpia);
  }

  /** Corta lo que hubiera y manda la nueva un momento despues. */
  function relevarYLanzar(limpia) {
    if (enMarcha) {
      /* Se para lo que hubiera y la nueva espera un momento.
       *
       * Parar no es instantaneo: manda tres eventos y alguno es a su vez una
       * animacion —levantarse de una silla tarda lo suyo—. Mandando la nueva
       * en el cuadro siguiente se la comia el levantarse, y el resultado era
       * que cambiar de animacion no hacia nada la mitad de las veces.
       *
       * Un tercio de segundo: lo justo para que el corte termine, y lo
       * bastante corto para que al pulsar responda en el acto. Con un
       * segundo entero funcionaba, pero parecia que se habia quedado
       * colgado. Se ajusta con esperaAlCambiar. */
      Reproductor.parar({ quien: limpia.quien, origen: limpia.origen });
      enMarcha = null;
      esperandoParaCambiar = {
        peticion: limpia,
        cuando: Date.now() + ESPERA_AL_CAMBIAR
      };
      return true;
      }

      /* Si ya habia una esperando su turno, se cambia por esta: acabas de
       pulsar otra cosa, asi que la de antes ya no la quieres. No se vuelve a
       parar, que ya se paro al encolar la primera. */
    if (esperandoParaCambiar) {
      esperandoParaCambiar.peticion = limpia;
      return true;
    }

    return lanzar(limpia);
  }

  /**
   * Da por terminada la animacion y limpia lo que dicen los menus.
   *
   * Solo el ESTADO: no se manda nada al juego. Se llama cuando la pose ya se
   * ha acabado por su cuenta, asi que no hay nada que cortar, y mandar el
   * corte de todas formas levantaria de la silla a quien acabe de sentarse.
   */
  function darPorTerminada(motivo) {
    apuntar('se da por terminada la animacion (' + motivo + ')');
    var peticion = { quien: FORMID_JUGADOR, evento: enMarcha, origen: 'fin' };
    enMarcha = null;
    /* Se avisa igual que al parar a mano: para quien escucha, que la pose se
       acabe sola o que la cortes es lo mismo, ya no esta. */
    avisarA(observadoresParar, peticion);
    decirAlPanel('parado');
  }

  /* Quien quiera enterarse de lo que se reproduce. Lo usan otros mods: el de
     musica, por ejemplo, para saber que alguien ha empezado a tocar el laud.
     Cada observador va en su propio try: uno que falle no puede dejar sin
     animacion a los demas ni al que la pidio. */
  var observadoresReproducir = [];
  var observadoresParar = [];

  function avisarA(lista, dato) {
    for (var i = 0; i < lista.length; i++) {
      try { lista[i](dato); } catch (e) { apuntar('un observador ha fallado: ' + e); }
    }
  }

  function apuntarObservador(lista, cb) {
    if (typeof cb !== 'function') return function () {};
    lista.push(cb);
    // Se devuelve la forma de dejar de escuchar, que si no no hay manera.
    return function () {
      var i = lista.indexOf(cb);
      if (i !== -1) lista.splice(i, 1);
    };
  }

  /** Desatasca. Corta el bucle y deja al personaje como recien llegado. */
  function pedirReiniciar(origen, quien) {
    Bucle.quitar();
    esperandoParaCambiar = null;
    enMarcha = null;
    var peticion = { quien: quien || FORMID_JUGADOR, origen: origen || 'desconocido' };
    var hecho = Reproductor.reiniciar(peticion);
    if (hecho) avisarA(observadoresParar, peticion);
    decirAlPanel('parado');
    return hecho;
  }

  function pedirParar(origen, quien) {
    Bucle.quitar();          // parar es parar: si habia bucle, se acaba
    esperandoParaCambiar = null;  // y si habia una esperando su turno, tambien
    enMarcha = null;
    var peticion = { quien: quien || FORMID_JUGADOR, origen: origen || 'desconocido' };
    var hecho = Reproductor.parar(peticion);
    if (hecho) avisarA(observadoresParar, peticion);
    /* Que el panel se entere de que ya no hay nada puesto. No pinta nada —no
       dice lo que suena—, pero olvida la ultima pedida, y sin eso marcar En
       bucle despues reviviria una animacion que ya no esta.

       El relevo entre animaciones no pasa por aqui: usa Reproductor.parar
       directamente, porque ahi la ultima pedida sigue valiendo. */
    decirAlPanel('parado');
    return hecho;
  }

  /* =======================================================================
   * CAPA 4 — LA INTERFAZ
   * =======================================================================
   *
   * LA INTERFAZ VIVE EN LA PAGINA, NO AQUI
   *
   * SkyrimPlatform dibuja por encima del juego una pagina web de verdad
   * (Chromium). Un plugin no puede pintar en ella directamente: solo puede
   * mandarle JavaScript con sp.browser.executeJavaScript.
   *
   * Asi que el panel se escribe abajo como una funcion normal, con su HTML y
   * su CSS, y se manda a la pagina convertida en texto con .toString(). Es el
   * mismo truco que usa el propio cliente de SkyMP para sus widgets, y tiene
   * una ventaja grande: el codigo de la interfaz se lee y se edita como codigo,
   * no como una cadena gigante llena de comillas escapadas.
   *
   * La unica regla: esta funcion NO puede usar nada de fuera de si misma. Al
   * convertirse en texto se queda sin el contexto del plugin. Todo lo que
   * necesite entra por su parametro.
   *
   * El aspecto imita al panel de inventario del servidor (mismos colores,
   * mismas tipografias, mismos remaches en las esquinas) para que los dos mods
   * parezcan del mismo juego. Las tipografias ya las carga la pagina de SkyMP,
   * asi que se piden por nombre con una alternativa por si no estan.
   * ======================================================================= */

  function panelEnLaPagina(datos, favoritosGuardados) {
    // Si ya estaba puesto, solo se le pasan los datos nuevos y no se duplica.
    if (window.__animplayer) {
      window.__animplayer.cargar(datos, favoritosGuardados);
      return;
    }

    var ID = 'animplayer';

    function avisar(tipo, carga) {
      try {
        if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) {
          window.skyrimPlatform.sendMessage(
            JSON.stringify({ type: 'animplayer:' + tipo, data: carga || null }));
        }
      } catch (e) { /* fuera del juego no hay a quien avisar */ }
    }

    /* ---------------------------------------------------------------- estilos
       Copiados del panel de inventario del servidor para que peguen:
         fondo   degradado 42,33,24 -> 20,16,12 al 97%
         borde   #6b5a3a, y #c9a35a cuando algo esta activo
         oro     #e8c987 para titulos, #c9a35a para acentos
         texto   #e9e1cf, y #b9ae94 para lo secundario
         letras  Bankir-Retro en titulos, Din-pro en el resto             */
    var css = [
      /* La capa ocupa toda la pantalla porque ahora hay dos cosas en sitios
         distintos: la rueda en el centro y la ventana de la lista arriba a la
         derecha. No deja pasar el raton salvo donde hay algo. */
      '#' + ID + '{position:fixed;inset:0;z-index:9000;',
      '  font-family:"Din-pro",sans-serif;font-size:15px;color:#e9e1cf;',
      '  pointer-events:none;user-select:none}',
      '#' + ID + ' *{box-sizing:border-box}',

      /* El panel, descolgado del borde de arriba. No hay pestana ni nada que
         pulsar antes: con la tecla aparece esto directamente. Por eso no lleva
         borde arriba, para que se vea pegado al canto de la pantalla. */
      /* Mas ancha que antes, pero sin pasarse de la pantalla en un portatil:
         el min() se encarga. Y alta hasta donde quepa, que con 611 animaciones
         cuanta mas lista se vea, menos hay que desplazar. */
      '#' + ID + ' .ap-panel{pointer-events:auto;position:absolute;top:0;',
      '  right:min(24px,2vw);width:min(520px,46vw);',
      '  max-height:92vh;display:none;flex-direction:column;',
      '  background:linear-gradient(180deg,rgba(42,33,24,.97) 0%,rgba(20,16,12,.97) 100%);',
      '  border:2px solid #6b5a3a;border-top:none;border-radius:0 0 4px 4px;',
      '  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 12px 32px rgba(0,0,0,.55),',
      '    inset 0 0 40px rgba(0,0,0,.5);padding:12px 14px 10px}',
      '#' + ID + '.ap-abierto .ap-panel{display:flex}',
      /* Los dos remaches de las esquinas, como el inventario. */
      '#' + ID + ' .ap-panel::before,#' + ID + ' .ap-panel::after{content:"";',
      '  position:absolute;top:8px;width:8px;height:8px;border-radius:50%;',
      '  background:radial-gradient(circle at 35% 35%,#e8c987,#4a3f2f 70%);',
      '  box-shadow:0 1px 2px rgba(0,0,0,.8)}',
      '#' + ID + ' .ap-panel::before{left:8px}',
      '#' + ID + ' .ap-panel::after{right:8px}',

      '#' + ID + ' .ap-cabecera{display:flex;align-items:center;gap:8px;',
      '  padding:2px 14px 9px;margin-bottom:9px;',
      '  border-bottom:1px solid rgba(107,90,58,.6)}',
      '#' + ID + ' .ap-titulo{font-family:"Bankir-Retro",serif;font-size:17px;',
      '  letter-spacing:2px;text-transform:uppercase;color:#e8c987;',
      '  text-shadow:0 1px 2px rgba(0,0,0,.8)}',
      /* A la derecha del titulo, en pequeno: que parte de la lista se esta
         viendo. Antes esto ocupaba el titulo entero, pero sin la pestana
         encima ya no habia nada que dijera de que va esta ventana. */
      '#' + ID + ' .ap-donde{flex:1;font-size:12.5px;color:#b9ae94;',
      '  text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-cerrar{cursor:pointer;color:#b9ae94;font-size:15px;',
      '  line-height:1;padding:2px 4px}',
      '#' + ID + ' .ap-cerrar:hover{color:#e8c987}',

      /* ------------------------------------------------------------ la rueda
         Los favoritos, en corro. Es lo que se usa sin pensar: no hace falta
         leer, te acuerdas de donde esta cada cosa. La lista de abajo sigue
         estando para todo lo demas. */
      /* ------------------------------------------------------- las dos vistas
         La rueda sola ocupa poco y es lo que se usa el 90% de las veces. La
         lista entera, con su buscador y sus categorias, esta detras de un
         boton: asi lo normal es una ventana pequena, y lo grande solo sale
         cuando se pide. */

      '#' + ID + '.ap-modo-lista .ap-rueda{display:none}',
      '#' + ID + '.ap-modo-rueda .ap-panel{display:none}',

      '#' + ID + ' .ap-cambio,#' + ID + ' .ap-volver{display:flex;align-items:center;justify-content:center;',
      '  gap:6px;margin-top:2px;padding:7px 0;cursor:pointer;font-size:13px;',
      '  letter-spacing:.5px;color:#b9ae94;',
      '  border:1px solid rgba(107,90,58,.5);border-radius:3px;',
      '  background:rgba(0,0,0,.25)}',
      '#' + ID + ' .ap-cambio:hover,#' + ID + ' .ap-volver:hover{',
      '  color:#e8c987;border-color:#c9a35a}',
      '#' + ID + ' .ap-cambio i,#' + ID + ' .ap-volver i{font-style:normal;',
      '  font-size:9px;color:#c9a35a}',
      '#' + ID + ' .ap-cambio{white-space:nowrap;padding:6px 12px}',

      /* El de reiniciar va mas discreto que los demas: hace falta tenerlo a
         mano, pero no es algo que se pulse a diario. */
      '#' + ID + ' .ap-reiniciar{cursor:pointer;font-size:12.5px;color:#8a7f68;',
      '  padding:4px 10px;border:1px solid transparent;border-radius:3px;',
      '  white-space:nowrap}',
      '#' + ID + ' .ap-reiniciar:hover{color:#c9a35a;',
      '  border-color:rgba(107,90,58,.7);background:rgba(0,0,0,.28)}',

      /* La rueda no lleva marco ni fondo: se ve el juego por debajo y solo
         destaca el corro. Es lo que sale al pulsar la tecla, asi que tiene que
         tapar lo menos posible. */
      '#' + ID + ' .ap-rueda{position:absolute;inset:0;display:none}',
      /* Con .ap-abierto delante, y no es un detalle: sin eso la rueda se
         quedaba en mitad de la pantalla con el panel cerrado. Antes no podia
         pasar porque la rueda vivia dentro de la ventana y se iba con ella;
         ahora es una superficie aparte y tiene que mirarlo por su cuenta. */
      '#' + ID + '.ap-abierto.ap-conrueda.ap-modo-rueda .ap-rueda{display:block}',
      /* El corro, centrado en la pantalla: justo donde esta el punto de mira.
         La barra cuelga debajo en vez de formar grupo con el, porque si fueran
         grupo lo centrado seria el conjunto y el corro quedaria mas arriba de
         la cuenta. */
      /* El corro se mide en vmin, no en pixeles: asi es igual de grande en una
         pantalla de portatil que en un monitor, y no se sale ni se queda
         ridiculo. El tope en pixeles evita que en un 4K ocupe media pared.

         El dibujo de dentro sigue en sus propias unidades (CORRO, DENTRO,
         AFUERA): el SVG lleva viewBox, asi que se estira solo hasta el tamano
         que le de la caja. Por eso aqui ya no hace falta cuadrar numeros con
         los del dibujo. */
      '#' + ID + ' .ap-corro-caja{position:absolute;top:50%;left:50%;',
      '  transform:translate(-50%,-50%);width:min(72vmin,720px);',
      '  height:min(72vmin,720px);pointer-events:auto}',
      '#' + ID + ' .ap-rueda svg{display:block;width:100%;height:100%}',

      /* Un relleno oscuro y translucido: suficiente para leer el rotulo y para
         que el sector se pueda pulsar, sin tapar el juego. */
      '#' + ID + ' .ap-sector{fill:rgba(12,9,6,.62);stroke:#6b5a3a;stroke-width:1;',
      '  cursor:pointer;transition:fill .12s,stroke .12s}',

      /* El sitio entero (sector y rotulo) crece un poco cuando el cursor esta
         encima. Crece hacia fuera porque el origen de la transformacion es el
         centro del corro, que es lo que hace que parezca que sale de la rueda
         en vez de moverse de sitio. */
      /* La transicion de la opacidad es la que hace que, al girar, los de la
         cola se vayan aclarando en vez de cambiar de golpe. */
      '#' + ID + ' .ap-sitio{transform-origin:280px 280px;',
      '  transition:transform .12s ease-out,opacity .28s ease-out}',
      '#' + ID + ' .ap-sitio.ap-mirando{transform:scale(1.06)}',
      '#' + ID + ' .ap-sitio.ap-mirando .ap-sector{fill:rgba(201,163,90,.3);',
      '  stroke:#e8c987;stroke-width:2}',

      '#' + ID + ' .ap-rotulo{font-size:13px;fill:#e9e1cf;pointer-events:none;',
      '  text-anchor:middle;paint-order:stroke;stroke:rgba(0,0,0,.85);',
      '  stroke-width:3px;stroke-linejoin:round}',

      /* El hueco del centro dice, entera, la que estas mirando. En un sector
         no cabe "Calentarse las manos de pie". */
      /* El hueco del centro: el nombre entero —en un sector no cabria— y
         debajo los dos mandos que hacen falta sin salir de la rueda. */
      '#' + ID + ' .ap-centro{position:absolute;top:50%;left:50%;',
      '  transform:translate(-50%,-50%);width:46%;text-align:center;',
      '  pointer-events:none;text-shadow:0 2px 6px #000,0 0 14px #000}',
      /* Se mide en vmin, igual que el corro: si no, la letra se queda
         pequenaja dentro de un hueco que en pantalla grande es enorme. El tope
         en pixeles evita que en un 4K se desmadre. */
      '#' + ID + ' .ap-centro b{display:block;font-family:"Bankir-Retro",serif;',
      '  font-size:min(2.2vmin,24px);letter-spacing:1px;color:#e8c987;',
      '  line-height:1.3}',
      '#' + ID + ' .ap-centro small{display:block;margin-top:5px;',
      '  font-size:min(1.45vmin,16px);color:#b9ae94}',
      '#' + ID + ' .ap-mandos{display:flex;flex-direction:column;',
      '  align-items:center;gap:10px;margin-top:14px;pointer-events:auto}',

      /* Los sitios se desvanecen segun se alejan de arriba. El de arriba es el
         que se mira, y el desvanecido va marcando el corro hacia abajo sin
         tapar el juego por detras. El que tiene el cursor encima se queda
         entero, que es el que importa. */
      '#' + ID + ' .ap-sitio.ap-mirando{opacity:1 !important}',

      /* Las flechas, a los lados. Solo salen cuando hay mas favoritos de los
         que caben, y pasan al grupo siguiente de golpe; la rueda del raton
         sigue girando de uno en uno, para ajustar. */
      '#' + ID + ' .ap-gira{position:absolute;top:50%;',
      '  transform:translateY(-50%);width:26px;height:46px;display:none;',
      '  align-items:center;justify-content:center;cursor:pointer;',
      '  color:#b9ae94;font-size:17px;background:rgba(0,0,0,.3);',
      '  border:1px solid rgba(107,90,58,.8);border-radius:3px}',
      '#' + ID + '.ap-girable .ap-gira{display:flex}',
      '#' + ID + ' .ap-gira:hover{color:#e8c987;border-color:#c9a35a;',
      '  background:rgba(201,163,90,.14)}',
      '#' + ID + ' .ap-gira-izq{left:-40px}',
      '#' + ID + ' .ap-gira-der{right:-40px}',

      /* La vuelta corta al girar, para que se vea que el corro se mueve. */
      /* El lienzo es mas grande que el corro a proposito: al pasar el cursor
         por encima, el sitio crece un 6% hacia fuera, y un SVG recorta por su
         borde. Con el lienzo justo, el sector crecido se cortaba por la mitad.
         overflow visible ademas por si alguna vez crece mas. */
      '#' + ID + ' .ap-corro svg{transform-origin:280px 280px;overflow:visible}',
      '#' + ID + ' .ap-corro.ap-vuelta-der svg{animation:ap-vuelta-der .22s ease-out}',
      '#' + ID + ' .ap-corro.ap-vuelta-izq svg{animation:ap-vuelta-izq .22s ease-out}',
      '@keyframes ap-vuelta-der{from{transform:rotate(calc(-1 * var(--paso)))}',
      '  to{transform:rotate(0)}}',
      '@keyframes ap-vuelta-izq{from{transform:rotate(var(--paso))}',
      '  to{transform:rotate(0)}}',

      /* La fila de debajo de la rueda: parar, el bucle y el paso a la lista.
         Tambien sin caja: botones sueltos sobre el juego. */
      /* Debajo del corro y centrado: lo unico que queda fuera de la rueda. */
      /* Colgada del corro, no de la pantalla: asi baja con el al crecer. */
      '#' + ID + ' .ap-barra{position:absolute;top:calc(100% + 14px);left:50%;',
      '  transform:translateX(-50%);display:flex;flex-direction:column;',
      '  align-items:center;gap:8px;pointer-events:auto;',
      '  text-shadow:0 1px 4px #000;white-space:nowrap}',

      '#' + ID + ' .ap-buscar{width:100%;padding:7px 9px;margin-bottom:8px;',
      '  background:rgba(0,0,0,.45);border:1px solid #6b5a3a;border-radius:3px;',
      '  color:#e9e1cf;font-family:inherit;font-size:15px;outline:none}',
      '#' + ID + ' .ap-buscar:focus{border-color:#c9a35a;',
      '  box-shadow:0 0 6px rgba(201,163,90,.3)}',
      '#' + ID + ' .ap-buscar::placeholder{color:#8a7f68}',

      '#' + ID + ' .ap-categorias{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}',
      '#' + ID + ' .ap-chip{cursor:pointer;padding:4px 9px;font-size:12.5px;',
      '  color:#b9ae94;background:rgba(0,0,0,.3);border:1px solid rgba(107,90,58,.55);',
      '  border-radius:2px;white-space:nowrap}',
      '#' + ID + ' .ap-chip:hover{color:#e9e1cf;border-color:#6b5a3a}',
      '#' + ID + ' .ap-chip.ap-puesto{color:#e8c987;border-color:#c9a35a;',
      '  background:rgba(201,163,90,.14)}',

      '#' + ID + ' .ap-lista{flex:1;overflow-y:auto;overflow-x:hidden;',
      '  margin:0 -4px;padding:0 4px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar{width:8px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-track{background:rgba(0,0,0,.35)}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-thumb{background:#6b5a3a;border-radius:2px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-thumb:hover{background:#c9a35a}',

      '#' + ID + ' .ap-grupo{font-family:"Bankir-Retro",serif;font-size:11.5px;',
      '  letter-spacing:2px;text-transform:uppercase;color:#c9a35a;',
      '  padding:9px 2px 4px;border-bottom:1px solid rgba(107,90,58,.35);',
      '  margin-bottom:3px}',

      '#' + ID + ' .ap-fila{display:flex;align-items:baseline;gap:8px;cursor:pointer;',
      '  padding:5px 7px;border:1px solid transparent;border-radius:2px}',
      '#' + ID + ' .ap-fila:hover,#' + ID + ' .ap-fila.ap-elegida{',
      '  background:rgba(201,163,90,.12);border-color:#6b5a3a}',
      '#' + ID + ' .ap-nombre{flex:1;min-width:0;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-evento{font-size:11.5px;color:#8a7f68;max-width:33%;',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

      /* La estrella de favorito. Gris apagada cuando no lo es, dorada cuando
         si. Se queda siempre en su sitio, tambien apagada, para que se vea
         que se puede pulsar sin tener que pasar el raton por encima. */
      /* Ancha y con margen negativo: antes eran 16 px y acertarle costaba.
         Ahora lo que responde al raton ocupa toda la altura de la fila. */
      '#' + ID + ' .ap-estrella{flex:none;width:26px;margin:-5px -4px -5px 2px;',
      '  padding:5px 0;text-align:center;font-size:18px;line-height:1;',
      '  color:#4a4034;cursor:pointer}',
      '#' + ID + ' .ap-estrella:hover{color:#b9ae94}',
      '#' + ID + ' .ap-estrella.ap-puesta{color:#e8c987;',
      '  text-shadow:0 0 5px rgba(232,201,135,.45)}',
      '#' + ID + ' .ap-estrella.ap-puesta:hover{color:#fff0cd}',
      '#' + ID + ' .ap-fila.ap-sinsinc .ap-nombre::after{content:" ·solo tu";',
      '  font-size:10px;color:#a8712f}',

      /* Las que se quedan puestas aunque camines. Son pocas y no se adivinan
         por el nombre, asi que se marcan. */
      '#' + ID + ' .ap-fila.ap-andando .ap-nombre::after{content:" ·andando";',
      '  font-size:10px;color:#7f9a6a}',

      /* Las que hay que estar sentado para que se vean. */
      '#' + ID + ' .ap-fila.ap-sentado .ap-nombre::after{content:" ·sentado";',
      '  font-size:10px;color:#8a93b0}',

      '#' + ID + ' .ap-vacio{padding:18px 4px;text-align:center;color:#b9ae94}',

      /* El pie lleva solo los dos mandos, centrados. Antes tenia delante el
         nombre de lo que sonaba; ya no se dice. */
      '#' + ID + ' .ap-pie{display:flex;align-items:center;gap:12px;',
      '  justify-content:center;margin-top:9px;padding-top:8px;',
      '  border-top:1px solid rgba(107,90,58,.6);font-size:12.5px;color:#b9ae94}',
      /* Un boton de contorno, sin relleno ni mayusculas.
         El degradado y el TODO EN MAYUSCULAS pesaban demasiado encima de una
         rueda que no tiene marco: parecia el boton mas importante de la
         pantalla cuando es el que menos se usa. Asi se ve, se pulsa, y no
         grita. */
      '#' + ID + ' .ap-boton{cursor:pointer;padding:6px 16px;font-size:14px;',
      '  letter-spacing:.3px;color:#cdbb90;background:rgba(0,0,0,.3);',
      '  border:1px solid rgba(107,90,58,.8);border-radius:3px;',
      '  transition:color .12s,border-color .12s,background .12s}',
      '#' + ID + ' .ap-boton:hover{color:#e8c987;border-color:#c9a35a;',
      '  background:rgba(201,163,90,.14)}',

      /* La casilla del bucle es nuestra, no un <input type=checkbox>. En el
         navegador que Skyrim dibuja por encima del juego los controles nativos
         se ven como quieren, no como uno les dice, asi que se pinta a mano: un
         cuadrado con una marca dentro. */
      '#' + ID + ' .ap-bucle{display:flex;align-items:center;gap:6px;',
      '  cursor:pointer;white-space:nowrap;color:#b9ae94}',
      '#' + ID + ' .ap-bucle:hover{color:#e9e1cf}',
      '#' + ID + ' .ap-casilla{width:13px;height:13px;flex:none;position:relative;',
      '  background:rgba(0,0,0,.45);border:1px solid #6b5a3a;border-radius:2px}',
      '#' + ID + ' .ap-bucle:hover .ap-casilla{border-color:#c9a35a}',
      '#' + ID + ' .ap-bucle.ap-puesto{color:#e8c987}',
      '#' + ID + ' .ap-bucle.ap-puesto .ap-casilla{border-color:#c9a35a;',
      '  background:rgba(201,163,90,.18)}',
      '#' + ID + ' .ap-bucle.ap-puesto .ap-casilla::after{content:"";position:absolute;',
      '  left:3px;top:0;width:5px;height:9px;border:solid #e8c987;',
      '  border-width:0 2px 2px 0;transform:rotate(42deg)}'
    ].join('');

    var estilo = document.createElement('style');
    estilo.id = ID + '-estilo';
    estilo.textContent = css;
    document.head.appendChild(estilo);

    /* ------------------------------------------------------------------ nodos */
    var raiz = document.createElement('div');
    raiz.id = ID;
    /* Dos superficies, no una ventana con dos contenidos:
         la RUEDA, en el centro de la pantalla y sin marco,
         la VENTANA de la lista, arriba a la derecha, como siempre.
       El bucle y el boton de parar salen en las dos, porque hacen falta en las
       dos; la casilla es un solo estado y refrescarBucle() pone las dos copias
       al dia. */
    raiz.innerHTML =
      '<div class="ap-rueda">' +
      '  <div class="ap-corro-caja">' +
      '    <div class="ap-corro"></div>' +
      '    <div class="ap-centro"></div>' +
      '    <div class="ap-gira ap-gira-izq">&#10094;</div>' +
      '    <div class="ap-gira ap-gira-der">&#10095;</div>' +
      '    <div class="ap-barra"><div class="ap-cambio"></div>' +
      '      <div class="ap-reiniciar" title="Si una animación se queda ' +
      'colgada: te saca del mueble, te devuelve el movimiento y la colisión, ' +
      'y recarga el personaje">Reiniciar animaciones</div></div>' +
      '  </div>' +
      '</div>' +
      '<div class="ap-panel">' +
      '  <div class="ap-cabecera"><div class="ap-titulo">Animaciones</div>' +
      '    <div class="ap-donde">Recomendadas</div>' +
      '    <div class="ap-cerrar" title="Cerrar (Esc)">&#10005;</div></div>' +
      '  <input class="ap-buscar" type="text" spellcheck="false"' +
      '         placeholder="Buscar por nombre o por id: rezar, IdleWave...">' +
      '  <div class="ap-categorias"></div>' +
      '  <div class="ap-lista"></div>' +
      '  <div class="ap-volver"></div>' +
      '  <div class="ap-reiniciar" style="text-align:center;margin-top:4px"' +
      '       title="Si una animación se queda colgada: te saca del mueble, ' +
      'te devuelve el movimiento y la colisión, y recarga el personaje">' +
      'Reiniciar animaciones</div>' +
      '  <div class="ap-pie">' +
      '    <div class="ap-bucle" title="Repetirla hasta que pulses Detener">' +
      '      <span class="ap-casilla"></span><span>En bucle</span></div>' +
      '    <div class="ap-boton ap-parar">Detener</div></div>' +
      '</div>';
    document.body.appendChild(raiz);

    var caja = raiz.querySelector('.ap-buscar');
    var bucles = raiz.querySelectorAll('.ap-bucle');   // se recoge otra vez al
                                                       // rehacer el centro
    var chips = raiz.querySelector('.ap-categorias');
    var lista = raiz.querySelector('.ap-lista');

    var donde = raiz.querySelector('.ap-donde');
    var corro = raiz.querySelector('.ap-corro');
    var cambio = raiz.querySelector('.ap-cambio');
    var volver = raiz.querySelector('.ap-volver');
    var centro = raiz.querySelector('.ap-centro');


    /* ------------------------------------------------------------------ estado */
    var animaciones = [];
    var categorias = [];
    var categoria = '';        // '' es "todas"
    var elegida = 0;           // para moverse con las flechas
    var abierto = false;
    var enBucle = false;       // la casilla del pie
    /* La ultima animacion pedida. Solo la usa la casilla de En bucle, para
       saber que repetir cuando la marcas con algo ya en marcha. No se ve en
       ningun sitio: el panel no dice lo que esta sonando, porque el juego no
       avisa de cuando termina y cualquier copia de eso acaba mintiendo. */
    var ultima = null;
    var favorito = {};         // evento -> true, lo que dicen las estrellas
    var modo = 'rueda';        // 'rueda' o 'lista'


    /**
     * Las palabras por las que se puede encontrar una animacion.
     *
     * Son las de su nombre, las de su id, y las extra que traiga. El id se
     * parte por sus mayusculas —IdleChairFrontEnter da idle, chair, front,
     * enter— y ademas se guarda entero, para que valga tanto escribir "chair"
     * como pegar "IdleChairFrontEnter".
     *
     * Devuelve todo junto y con un espacio delante, porque asi buscar "por
     * principio de palabra" es mirar si aparece " " + lo escrito, que es una
     * sola operacion y no hace falta ninguna expresion regular por tecla.
     */
    function palabrasDe(a) {
      var partido = String(a.evento)
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_\-]+/g, ' ');
      return ' ' + llano(a.nombre + ' ' + a.evento + ' ' + partido + ' ' +
                         (a.busqueda || '') +
                         (a.andando ? ' andando caminar andar' : '') +
                         (a.sentado ? ' sentado silla' : ''));
    }

    /** Prepara un texto para buscar sin acentos ni mayusculas. */
    function llano(t) {
      return String(t || '').toLowerCase()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
        .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
    }

    function cargar(d, favs) {
      animaciones = (d && d.animaciones) || [];
      categorias = (d && d.categorias) || [];
      if (favs) {
        favorito = {};
        for (var f = 0; f < favs.length; f++) favorito[favs[f]] = true;
      }

      /* El texto de busqueda de cada ficha se calcula UNA vez, aqui, y no en
         cada tecla que se escribe: son setecientas fichas y la busqueda tiene
         que ir instantanea. */
      for (var i = 0; i < animaciones.length; i++) {
        animaciones[i]._busca = palabrasDe(animaciones[i]);
      }
      pintarCategorias();
      pintarRueda();
      pintar();
      ponerModo(modo);
    }

    /**
     * Las que encajan con lo escrito y con la categoria elegida.
     *
     * Sin nada escrito y sin categoria se ensenan solo las recomendadas: la
     * lista entera son casi setecientas y abrir un menu que empieza con
     * "Ambush Enter Instant" no le sirve a nadie. En cuanto escribes o eliges
     * una categoria, se busca en todas.
     */
    function filtrar() {
      var texto = llano(caja.value).trim();
      var partes = texto ? texto.split(/\s+/) : [];
      var soloFavoritos = categoria === 'favoritos';
      /* Sin escribir nada y sin categoria: tus favoritos y las recomendadas.
         La lista entera son casi setecientas, y un menu que empieza por
         "Ambush Enter Instant" no le sirve a nadie. */
      var soloLoDeSiempre = !texto && !categoria;
      var salida = [];

      for (var i = 0; i < animaciones.length; i++) {
        var a = animaciones[i];
        if (soloFavoritos) {
          if (!favorito[a.evento]) continue;
        } else if (categoria && categoria !== 'todas' && a.categoria !== categoria) {
          continue;                       // "todas" no filtra por nada
        }
        if (soloLoDeSiempre && !a.destacada && !favorito[a.evento]) continue;
        /* Por PRINCIPIO de palabra: se busca " " + lo escrito. Antes era por
           subcadena y "laud" encontraba Ap-laud-ir. */
        var vale = true;
        for (var p = 0; p < partes.length; p++) {
          if (a._busca.indexOf(' ' + partes[p]) === -1) { vale = false; break; }
        }
        if (vale) salida.push(a);
      }

      /* Los favoritos van siempre delante, salvo cuando ya estas mirando solo
         los favoritos, que entonces seria ordenar por nada. El orden entre los
         demas no se toca: es el del catalogo, por categoria y nombre. */
      if (!soloFavoritos) {
        var arriba = [], abajo = [];
        for (var j = 0; j < salida.length; j++) {
          (favorito[salida[j].evento] ? arriba : abajo).push(salida[j]);
        }
        salida = arriba.concat(abajo);
        if (arriba.length) {
          return { lista: salida, soloLoDeSiempre: soloLoDeSiempre,
                   favoritos: arriba.length };
        }
      }
      return { lista: salida, soloLoDeSiempre: soloLoDeSiempre, favoritos: 0 };
    }

    /* -------------------------------------------------------------- la rueda
     * Ocho sitios como mucho. Con ocho favoritos o menos, el corro se reparte
     * entero y no hay nada que girar. Con mas, los ocho sitios son una ventana
     * sobre la lista: al girar, los de antes se van por un lado y aparecen los
     * siguientes por el otro.
     *
     * Se dibuja con SVG y no con divs girados porque un sector de corona no es
     * un rectangulo: con CSS habria que recortar cada trozo a mano, y aqui es
     * una linea de path.
     */
    var SITIOS = 15;
    var giro = 0;              // por donde va la ventana sobre los favoritos
    var mirando = -1;          // el sitio bajo el raton
    function laRueda() {
      var fuera = [];
      for (var i = 0; i < animaciones.length; i++) {
        if (favorito[animaciones[i].evento]) fuera.push(animaciones[i]);
      }
      return fuera;
    }

    /** Un punto del corro. El angulo va en grados, y 0 es arriba. */
    function enElCorro(cx, cy, radio, grados) {
      var a = (grados - 90) * Math.PI / 180;
      return [cx + radio * Math.cos(a), cy + radio * Math.sin(a)];
    }

    /** El camino de un sector de corona, de grados1 a grados2. */
    function sector(cx, cy, dentro, fuera, g1, g2) {
      var a = enElCorro(cx, cy, fuera, g1);
      var b = enElCorro(cx, cy, fuera, g2);
      var c = enElCorro(cx, cy, dentro, g2);
      var d = enElCorro(cx, cy, dentro, g1);
      var largo = (g2 - g1) > 180 ? 1 : 0;
      return 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) +
             'A' + fuera + ',' + fuera + ' 0 ' + largo + ',1 ' +
                   b[0].toFixed(1) + ',' + b[1].toFixed(1) +
             'L' + c[0].toFixed(1) + ',' + c[1].toFixed(1) +
             'A' + dentro + ',' + dentro + ' 0 ' + largo + ',0 ' +
                   d[0].toFixed(1) + ',' + d[1].toFixed(1) + 'Z';
    }

    /** Recorta un nombre largo para que quepa en un sector. */
    function acortar(texto, cuanto) {
      if (texto.length <= cuanto) return texto;
      return texto.slice(0, cuanto - 1).replace(/\s+\S*$/, '') + '\u2026';
    }

    /** Parte un texto en lineas de como mucho <ancho> letras, hasta <tope>. */
    function repartir(texto, ancho, tope) {
      var palabras = texto.split(' ');
      var lineas = [];
      var actual = '';
      for (var i = 0; i < palabras.length; i++) {
        var prueba = actual ? actual + ' ' + palabras[i] : palabras[i];
        if (prueba.length > ancho && actual) {
          lineas.push(actual);
          actual = palabras[i];
          if (lineas.length === tope - 1) break;
        } else {
          actual = prueba;
        }
      }
      if (actual) lineas.push(actual);
      return lineas.slice(0, tope);
    }

    /* Las medidas del corro. Tienen que ir a la par con el ancho de
       .ap-corro-caja y con los transform-origin del CSS. */
    var CORRO = 560, CENTRO = 280, DENTRO = 150, AFUERA = 254;

    /** Cuantos sitios hay dibujados ahora mismo, para no rehacerlos por nada. */
    var dibujados = -1;

    /** Arma los sitios vacios. Solo hace falta si cambia cuantos hay. */
    function armarCorro(cuantos) {
      var paso = 360 / cuantos;
      var trozos = ['<svg width="' + CORRO + '" height="' + CORRO +
                    '" viewBox="0 0 ' + CORRO + ' ' + CORRO + '">'];
      for (var i = 0; i < cuantos; i++) {
        var g1 = i * paso - paso / 2 + 1;     // el +1 deja la rendija entre sitios
        var g2 = (i + 1) * paso - paso / 2 - 1;
        trozos.push('<g class="ap-sitio" data-sitio="' + i + '">' +
                    '<path class="ap-sector" d="' +
                    sector(CENTRO, CENTRO, DENTRO, AFUERA, g1, g2) + '"/></g>');
      }
      trozos.push('</svg>');
      corro.innerHTML = trozos.join('');
      corro.style.setProperty('--paso', paso + 'deg');
    }

    /**
     * Pone en cada sitio la animacion que le toca ahora.
     *
     * Aqui esta el truco de que la cola se aclare al girar: NO se rehacen los
     * sitios, se les cambia lo de dentro. Como el <g> sigue siendo el mismo, el
     * navegador puede animar el salto de opacidad; si se rehicieran, cada uno
     * nacería ya con su opacidad final y el cambio seria seco.
     */
    function rellenarCorro(favs, cuantos) {
      var paso = 360 / cuantos;
      var sitios = corro.querySelectorAll('.ap-sitio');
      for (var i = 0; i < sitios.length; i++) {
        var a = favs[(i + giro) % favs.length];
        var g = sitios[i];
        g.setAttribute('data-evento', a.evento);

        var medio = enElCorro(CENTRO, CENTRO, (DENTRO + AFUERA) / 2, i * paso);
        var lineas = repartir(acortar(a.nombre, 38), 15, 3);
        var arriba = medio[1] - (lineas.length - 1) * 7 + 4;
        var textos = '';
        for (var L = 0; L < lineas.length; L++) {
          textos += '<text class="ap-rotulo" x="' + medio[0].toFixed(0) +
                    '" y="' + (arriba + L * 14).toFixed(0) + '">' +
                    escapar(lineas[L]) + '</text>';
        }
        // Se conserva el <path>, que no cambia, y se renuevan los rotulos.
        var camino = g.querySelector('path');
        g.innerHTML = camino.outerHTML + textos;
      }
    }

    function pintarRueda() {
      var favs = laRueda();
      raiz.classList.toggle('ap-conrueda', favs.length > 0);
      raiz.classList.toggle('ap-girable', favs.length > SITIOS);
      if (!favs.length) {
        corro.innerHTML = '';
        centro.innerHTML = '';
        dibujados = -1;
        return;
      }

      var cuantos = Math.min(favs.length, SITIOS);
      if (cuantos !== dibujados) {
        armarCorro(cuantos);
        dibujados = cuantos;
      }
      rellenarCorro(favs, cuantos);
      pintarCentro();
    }

    /* Los mandos del hueco. Son los mismos que los de la ventana de la lista
       —misma clase, mismo comportamiento— y la casilla la llevan los dos a la
       vez desde refrescarBucle. */
    function mandosDelCentro() {
      return '<div class="ap-mandos">' +
             '<div class="ap-boton ap-parar">Detener</div>' +
             '<div class="ap-bucle" title="Repetirla hasta que pulses Detener">' +
             '<span class="ap-casilla"></span><span>En bucle</span></div>' +
             '</div>';
    }

    function pintarCentro() {
      var favs = laRueda();
      if (!favs.length) { centro.innerHTML = ''; return; }

      var cabeza;
      if (mirando >= 0) {
        var a = favs[(mirando + giro) % favs.length];
        cabeza = '<b>' + escapar(a.nombre) + '</b>' +
                 '<small>' + escapar(a.evento) +
                 (a.andando ? ' · se puede andar' : '') +
                 (a.sentado ? ' · hay que estar sentado' : '') +
                 (a.sincroniza === false ? ' · solo tú' : '') + '</small>';
      } else {
        cabeza = '<b>\u2605 Favoritos</b><small>' +
                 (favs.length > SITIOS
                   ? (giro + 1) + '-' + ((giro + SITIOS - 1) % favs.length + 1) +
                     ' de ' + favs.length
                   : favs.length) + '</small>';
      }
      centro.innerHTML = cabeza + mandosDelCentro();
      // El hueco se rehace entero, asi que hay que volver a coger los mandos.
      bucles = raiz.querySelectorAll('.ap-bucle');
      refrescarBucle();
    }

    function girar(cuanto) {
      var favs = laRueda();
      if (favs.length <= SITIOS) return;
      giro = (giro + cuanto + favs.length) % favs.length;
      pintarRueda();

      /* La vuelta corta. Hay que quitar la clase, forzar al navegador a
         recalcular y volver a ponerla; si no, dos giros seguidos no reinician
         la animacion y el segundo no se ve. */
      var clase = cuanto > 0 ? 'ap-vuelta-der' : 'ap-vuelta-izq';
      corro.classList.remove('ap-vuelta-der', 'ap-vuelta-izq');
      void corro.offsetWidth;
      corro.classList.add(clase);
      // Y se quita al acabar, que si no queda puesta para siempre y cualquiera
      // que mire el DOM despues se pregunta si el corro esta girando.
      corro.addEventListener('animationend', function quitar() {
        corro.classList.remove('ap-vuelta-der', 'ap-vuelta-izq');
        corro.removeEventListener('animationend', quitar);
      });
    }

    corro.addEventListener('mousemove', function (e) {
      var sitio = e.target.closest ? e.target.closest('.ap-sitio') : null;
      var cual = sitio ? parseInt(sitio.getAttribute('data-sitio'), 10) : -1;
      if (cual === mirando) return;
      mirando = cual;
      var antes = corro.querySelector('.ap-mirando');
      if (antes) antes.classList.remove('ap-mirando');
      if (sitio) sitio.classList.add('ap-mirando');
      pintarCentro();
    });

    corro.addEventListener('mouseleave', function () {
      mirando = -1;
      var antes = corro.querySelector('.ap-mirando');
      if (antes) antes.classList.remove('ap-mirando');
      pintarCentro();
    });

    corro.addEventListener('click', function (e) {
      var sitio = e.target.closest ? e.target.closest('.ap-sitio') : null;
      if (!sitio) return;
      var evento = sitio.getAttribute('data-evento');
      reproducir(evento);

      /* Y se cierra la rueda.
       *
       * Mientras el panel esta abierto, el raton es de la pagina y no del
       * juego: no puedes girar la camara ni acercarla, que es justo lo que
       * hace falta para colocarte bien y mirar la animacion. Al elegir ya has
       * terminado con la rueda, asi que se quita de enmedio y el raton vuelve
       * al juego.
       *
       * Se cierra siempre, tambien cuando la pulsacion lo que hace es PARAR
       * la que ya sonaba. Antes se quedaba abierta en ese caso, pero para
       * saberlo la pagina tenia que llevar su propia copia de lo que suena, y
       * esa copia es justo lo que se ha quitado: quien lo sabe es el plugin.
       *
       * Desde la lista no se cierra: alli estas rebuscando y probando. */
      cerrar();
    });

    raiz.querySelector('.ap-corro-caja').addEventListener('wheel', function (e) {
      e.preventDefault();
      girar(e.deltaY > 0 ? 1 : -1);          // la rueda, de uno en uno
    });

    /* Las flechas pasan al grupo siguiente entero: con veintitantos favoritos,
       ir de uno en uno hasta el ultimo es un suplicio. */
    raiz.querySelector('.ap-gira-izq').addEventListener('click', function () {
      girar(-Math.min(SITIOS, laRueda().length - 1));
    });
    raiz.querySelector('.ap-gira-der').addEventListener('click', function () {
      girar(Math.min(SITIOS, laRueda().length - 1));
    });


    /**
     * Cambia entre la rueda y la lista.
     *
     * Sin favoritos no hay rueda que ensenar, asi que se fuerza la lista y el
     * boton dice que se pueden marcar: es mejor que un corro vacio o un boton
     * que lleva a una pantalla en blanco.
     */
    function ponerModo(cual) {
      var hayRueda = laRueda().length > 0;
      modo = hayRueda ? cual : 'lista';
      raiz.classList.toggle('ap-modo-rueda', modo === 'rueda');
      raiz.classList.toggle('ap-modo-lista', modo === 'lista');

      cambio.innerHTML = '<i>\u25be</i> Ver todas las animaciones (' +
                         animaciones.length + ')';
      volver.innerHTML = hayRueda
        ? '<i>\u25b4</i> Volver a la rueda'
        : '<i>\u2605</i> Marca animaciones con la estrella y saldrán en la rueda';

      if (modo === 'lista' && abierto) { caja.focus(); caja.select(); }
      pintarTitulo();
    }

    function pintarTitulo() {
      if (modo === 'rueda') {
        donde.textContent = laRueda().length + ' favoritos';
        return;
      }
      var r = filtrar();
      donde.textContent = caja.value.trim()
        ? r.lista.length + (r.lista.length === 1 ? ' resultado' : ' resultados')
        : (categoria ? nombreDe(categoria) : 'Recomendadas');
    }

    cambio.addEventListener('click', function () { ponerModo('lista'); });
    volver.addEventListener('click', function () {
      if (!laRueda().length) return;      // no hay rueda a la que volver
      ponerModo('rueda');
    });

    function pintarCategorias() {
      var html = ['<div class="ap-chip' + (categoria ? '' : ' ap-puesto') +
                  '" data-cat="">Recomendadas</div>'];

      /* Todas: el catalogo entero, sin recortar por recomendadas ni por
         categoria. Es la que hay que pulsar para rebuscar a mano, y con ella
         puesta la barra busca en las 674. */
      html.push('<div class="ap-chip' + (categoria === 'todas' ? ' ap-puesto' : '') +
                '" data-cat="todas">Todas ' +
                '<span style="color:#8a7f68">' + animaciones.length + '</span></div>');

      /* La de favoritos solo sale si tienes alguno: una categoria vacia y
         permanente seria un boton que no hace nada. */
      var cuantosFav = 0;
      for (var f = 0; f < animaciones.length; f++) {
        if (favorito[animaciones[f].evento]) cuantosFav++;
      }
      if (cuantosFav) {
        html.push('<div class="ap-chip' +
                  (categoria === 'favoritos' ? ' ap-puesto' : '') +
                  '" data-cat="favoritos">\u2605 Favoritos ' +
                  '<span style="color:#8a7f68">' + cuantosFav + '</span></div>');
      }
      var cuenta = {};
      for (var i = 0; i < animaciones.length; i++) {
        cuenta[animaciones[i].categoria] = (cuenta[animaciones[i].categoria] || 0) + 1;
      }
      for (var j = 0; j < categorias.length; j++) {
        var c = categorias[j];
        if (!cuenta[c.clave]) continue;              // categoria sin nada dentro
        html.push('<div class="ap-chip' + (categoria === c.clave ? ' ap-puesto' : '') +
                  '" data-cat="' + c.clave + '">' + c.nombre +
                  ' <span style="color:#8a7f68">' + cuenta[c.clave] + '</span></div>');
      }
      chips.innerHTML = html.join('');
    }

    function pintar() {
      var r = filtrar();
      if (elegida >= r.lista.length) elegida = Math.max(0, r.lista.length - 1);

      if (!r.lista.length) {
        lista.innerHTML = '<div class="ap-vacio">Nada con eso</div>';
        donde.textContent = 'sin resultados';
        return;
      }

      var html = [];
      var grupo = null;
      var yaSalioElResto = false;
      for (var i = 0; i < r.lista.length; i++) {
        var a = r.lista[i];
        var esFav = !!favorito[a.evento] && categoria !== 'favoritos';

        /* Los favoritos van arriba y con su propia cabecera; el resto empieza
           donde se acaban ellos. */
        if (esFav && i === 0) {
          html.push('<div class="ap-grupo">\u2605 Favoritos</div>');
        } else if (!esFav && !yaSalioElResto) {
          yaSalioElResto = true;
          if (r.soloLoDeSiempre) {
            html.push('<div class="ap-grupo">Recomendadas &nbsp;·&nbsp; escribe o ' +
                      'elige una categoría para ver las ' + animaciones.length +
                      '</div>');
          } else if (r.favoritos) {
            html.push('<div class="ap-grupo">Las demas</div>');
          }
        }

        if (!esFav && !r.soloLoDeSiempre && !categoria && a.categoria !== grupo) {
          grupo = a.categoria;
          html.push('<div class="ap-grupo">' + nombreDe(grupo) + '</div>');
        }
        html.push(
          '<div class="ap-fila' + (i === elegida ? ' ap-elegida' : '') +
          (a.sincroniza === false ? ' ap-sinsinc' : '') +
          (a.andando ? ' ap-andando' : '') +
          (a.sentado ? ' ap-sentado' : '') +
          '" data-evento="' + a.evento + '" data-i="' + i + '"' +
          (a.sincroniza === false && a.motivo
            ? ' title="Los demas no la veran: ' + escapar(a.motivo) + '"' : '') + '>' +
          '<span class="ap-nombre">' + escapar(a.nombre) + '</span>' +
          '<span class="ap-evento">' + escapar(a.evento) + '</span>' +
          '<span class="ap-estrella' + (favorito[a.evento] ? ' ap-puesta' : '') +
          '" data-fav="' + a.evento + '" title="' +
          (favorito[a.evento] ? 'Quitar de favoritos' : 'Guardar en favoritos') +
          '">\u2605</span></div>');
      }
      lista.innerHTML = html.join('');
      pintarTitulo();
      var viva = lista.querySelector('.ap-elegida');
      if (viva && viva.scrollIntoView) viva.scrollIntoView({ block: 'nearest' });
    }

    function nombreDe(clave) {
      if (clave === 'favoritos') return '\u2605 Favoritos';
      if (clave === 'todas') return 'Todas';
      for (var i = 0; i < categorias.length; i++) {
        if (categorias[i].clave === clave) return categorias[i].nombre;
      }
      return clave;
    }

    function escapar(t) {
      return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ------------------------------------------------------------------ acciones */
    /** Pone al dia las dos copias de la casilla: la de la rueda y la de la lista. */
    function refrescarBucle() {
      for (var j = 0; j < bucles.length; j++) {
        bucles[j].classList.toggle('ap-puesto', enBucle);
      }
    }

    function reproducir(evento) {
      if (!evento) return;
      ultima = evento;
      /* Pulsar la que ya esta sonando la para, pero eso lo decide el plugin:
         es el unico que sabe lo que hay puesto. La pagina llevaba antes su
         propia copia para adelantarse, y con ella el parche de que se quedara
         desfasada. Desde aqui se pide y punto. */
      // El bucle viaja con la peticion: quien reproduce es quien decide si
      // ademas hay que repetirla, y asi no hacen falta dos mensajes.
      avisar('reproducir', { evento: evento, bucle: enBucle });
    }

    /* abrir y cerrar no hacen nada si ya estabas asi, y eso no es un detalle:
       el plugin, al recibir el aviso de "me he abierto", manda abrir para
       enterarse del cambio. Sin esta guarda serian dos espejos mirandose. */
    function abrir() {
      if (abierto) return;
      abierto = true;
      raiz.classList.add('ap-abierto');
      /* Se empieza siempre por la rueda: es lo pequeno. Si te quedaste en la
         lista la vez anterior, da igual; abrir tiene que ocupar poco. */
      ponerModo('rueda');
      if (modo === 'lista') { caja.focus(); caja.select(); }
      avisar('abierto');
    }

    function cerrar() {
      if (!abierto) return;
      abierto = false;
      raiz.classList.remove('ap-abierto');
      caja.blur();
      avisar('cerrado');
    }

    function alternar() { if (abierto) cerrar(); else abrir(); }

    /* ------------------------------------------------------------------ sucesos */
    raiz.querySelector('.ap-cerrar').addEventListener('click', cerrar);
    /* Los mandos estan duplicados (rueda y lista), asi que se escuchan por
       delegacion en vez de atarlos uno a uno. */
    raiz.addEventListener('click', function (e) {
      if (!e.target.closest) return;
      if (e.target.closest('.ap-reiniciar')) {
        ultima = null;
        enBucle = false;
        refrescarBucle();
        avisar('reiniciar');
        return;
      }
      if (e.target.closest('.ap-parar')) {
        ultima = null;
        avisar('parar');
      }
    });

    /* La casilla del bucle. Marcarla con algo ya en marcha lo pone en bucle
       ahora mismo, sin tener que volver a pulsar la animacion; desmarcarla lo
       corta pero deja la pose como esta, que para eso no es el boton de parar. */
    raiz.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.ap-bucle')) return;
      enBucle = !enBucle;
      refrescarBucle();
      if (ultima) avisar('bucle', { activo: enBucle, evento: ultima });
    });

    caja.addEventListener('input', function () { elegida = 0; pintar(); });

    chips.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.ap-chip') : null;
      if (!chip) return;
      categoria = chip.getAttribute('data-cat') || '';
      elegida = 0;
      pintarCategorias();
      pintar();
    });

    lista.addEventListener('click', function (e) {
      /* La estrella se mira antes que la fila: pulsarla guarda el favorito y
         NO reproduce nada, que si no marcar algo te dejaria al personaje
         haciendo la animacion sin haberla pedido. */
      var estrella = e.target.closest ? e.target.closest('.ap-estrella') : null;
      if (estrella) {
        e.stopPropagation();
        var evento = estrella.getAttribute('data-fav');
        if (favorito[evento]) delete favorito[evento];
        else favorito[evento] = true;
        avisar('favorito', { evento: evento, activo: !!favorito[evento] });
        pintarCategorias();
        pintarRueda();
        pintar();
        ponerModo(modo);
        return;
      }

      var fila = e.target.closest ? e.target.closest('.ap-fila') : null;
      if (!fila) return;
      elegida = parseInt(fila.getAttribute('data-i'), 10) || 0;
      pintar();
      reproducir(fila.getAttribute('data-evento'));
    });

    /* Las flechas y el Enter dentro de la caja: escribir "laud" y dar a Enter
       tiene que reproducirla sin tocar el raton. */
    caja.addEventListener('keydown', function (e) {
      var r = filtrar();
      if (e.key === 'ArrowDown') {
        elegida = Math.min(elegida + 1, r.lista.length - 1); pintar(); e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        elegida = Math.max(elegida - 1, 0); pintar(); e.preventDefault();
      } else if (e.key === 'Enter') {
        if (r.lista[elegida]) reproducir(r.lista[elegida].evento);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        cerrar(); e.preventDefault();
      }
    });

    /* Si SkyMP le quita el foco al navegador por su cuenta (con F6, o al abrir
       otra cosa), el panel se cierra: sin foco el raton no llega a la pagina y
       quedaria una ventana ahi puesta que no se puede ni tocar ni cerrar. */
    window.addEventListener('skymp5-client:browserUnfocused', function () { cerrar(); });

    /* Lo que el plugin puede pedirle al panel desde el juego. */
    window.__animplayer = {
      abrir: abrir,
      cerrar: cerrar,
      alternar: alternar,

      /* El juego ha cortado la animacion por su cuenta —al saltar, o porque
         otro mod lo pidio—. Se limpia lo que se ve, y NO se avisa de vuelta:
         quien corto ya lo sabe, y contestarle seria dar vueltas. */
      /* El plugin avisa de que ya no hay nada puesto: lo haya cortado el
         boton, un salto, o se haya acabado la pose sola. No hay nada que
         despintar —el panel no dice lo que suena—, pero si hay que olvidar la
         ultima: si no, marcar En bucle despues reviviria una animacion que ya
         no esta. */
      parado: function () {
        ultima = null;
      },
      cargar: cargar,
      favoritos: function () {
        var f = [];
        for (var e in favorito) if (favorito[e]) f.push(e);
        return f;
      },
      estaAbierto: function () { return abierto; },
      enBucle: function () { return enBucle; }
    };

    cargar(datos, favoritosGuardados || []);
    avisar('listo', { animaciones: animaciones.length,
                      favoritos: (favoritosGuardados || []).length });
  }

  /* =======================================================================
   * CAPA 5 — EL PEGAMENTO
   * =======================================================================
   * La tecla, el foco del navegador, los mensajes que suben de la pagina, y la
   * cola que hace que las llamadas al juego se hagan donde se pueden hacer.
   * ======================================================================= */

  var puesto = false;          // el panel ya esta inyectado en la pagina
  var abierto = false;         // el panel esta desplegado
  var pantallaDeCarga = false;
  var cargaTerminoEn = null;
  var arranque = Date.now();

  /* La cola. Las llamadas al juego que nacen de un mensaje del navegador se
     apuntan aqui y se ejecutan en el siguiente "update", que si es un contexto
     nativo valido. Hacerlas en el propio callback da un error del juego
     ("can't be called in this context"), y en el peor caso lo cuelga. */
  var pendientes = [];
  function encolar(accion) { pendientes.push(accion); }

  sp.on('update', function () {
    if (pendientes.length) {
      var ahora = pendientes;
      pendientes = [];
      for (var i = 0; i < ahora.length; i++) {
        try { ahora[i](); } catch (e) { apuntar('accion fallida: ' + e); }
      }
    }
    /* El update es un contexto nativo valido, que es justo lo que hace falta
       para leer el teclado y para volver a mandar la animacion del bucle. */
    vigilarElSalto();
    vigilarElFin();
    vigilarElCambio();
    mirarLaTecla();

    if (abrirCuandoSePueda && sePuedeAbrir()) {
      abrirCuandoSePueda = false;
      apuntar('el mundo ya esta listo: abriendo');
      abrir();
    }

    Bucle.latido();
  });

  /* --------------------------------------------------------------- la pagina */

  /**
   * Mete el panel en la pagina del navegador de SkyMP.
   *
   * Se manda la funcion convertida en texto junto con el catalogo ya
   * serializado. La funcion es idempotente: si ya estaba puesta, solo recarga
   * los datos, asi que llamar dos veces no duplica nada.
   */
  function inyectar() {
    try {
      sp.browser.executeJavaScript(
        '(' + panelEnLaPagina.toString() + ')(' + JSON.stringify(catalogo) +
        ',' + JSON.stringify(listaFavoritos()) + ');');
      puesto = true;
      apuntar('panel puesto en la pagina, ' + catalogo.animaciones.length + ' animaciones');
    } catch (e) {
      apuntar('no se pudo poner el panel: ' + e);
    }
  }

  /**
   * Le pide algo al panel, y se entera si el panel ya no esta.
   *
   * La pagina del navegador no es nuestra: es la de SkyMP, y se puede recargar
   * (al conectar, al reconectar, si el servidor la cambia). Cuando eso pasa,
   * el panel que habiamos metido desaparece, pero aqui seguiamos creyendo que
   * estaba puesto, asi que pulsar la tecla no hacia nada. Para siempre, no
   * "a veces".
   *
   * Ahora, si al pedirle algo no esta, la propia pagina lo dice y lo volvemos
   * a poner. Se pregunta en el mismo mensaje en el que se le pide la cosa, que
   * no cuesta nada.
   */
  function decirAlPanel(metodo) {
    try {
      sp.browser.executeJavaScript(
        'if (window.__animplayer) { window.__animplayer.' + metodo + '(); }' +
        ' else if (window.skyrimPlatform && window.skyrimPlatform.sendMessage) {' +
        '   window.skyrimPlatform.sendMessage(JSON.stringify(' +
        '     { type: "animplayer:falta", data: { querian: "' + metodo + '" } })); }');
    } catch (e) { /* si no hay navegador, no hay nada que decir */ }
  }

  /* ------------------------------------------------------------ abrir y cerrar */

  /* Abrir y cerrar son dos cosas distintas y conviene no mezclarlas:
   *
   *   el ESTADO   (la variable abierto) se cambia al momento
   *   el EFECTO   (foco del navegador, movimiento del personaje) se encola
   *
   * Si el estado se cambiara tambien dentro de la cola, dos avisos seguidos de
   * la pagina se pisarian: al llegar el "me he cerrado" la variable todavia
   * diria que esta cerrado —porque el "me he abierto" anterior sigue en la
   * cola— y el cierre se descartaria. El plugin se quedaria creyendo que hay
   * un panel abierto que ya no existe, con el movimiento del personaje
   * bloqueado y sin nada en pantalla que lo explique.
   *
   * Pasa de verdad: SkyMP le quita el foco al navegador por su cuenta, el panel
   * se cierra solo, y los dos avisos llegan en la misma vuelta. */

  function aplicarAbierto() {
    try {
      sp.browser.setVisible(true);
      sp.browser.setFocused(true);
      // SkyMP avisa a su propia interfaz del foco con estos dos eventos. Se
      // mandan tambien desde aqui para no dejarla desincronizada.
      sp.browser.executeJavaScript(
        "window.dispatchEvent(new CustomEvent('skymp5-client:browserFocused', {}))");
    } catch (e) { apuntar('no se pudo enfocar el navegador: ' + e); }

    /* Sin esto el personaje sigue andando mientras escribes en la barra de
       busqueda. Solo se quita el movimiento: la camara, mirar, los menus y el
       combate se quedan como estaban, igual que hace el mod de inventario.

       Pero NO si estas sentado: quitar el movimiento rompe el estado de mueble
       y te levanta, y abrir un menu no tiene por que sacarte de la silla.
       Sentado tampoco hace falta: no te vas a ir andando. */
    if (QUITAR_MOVIMIENTO && !Reproductor.enUnMueble({ quien: FORMID_JUGADOR })) {
      try {
        sp.Game.disablePlayerControls(true, false, false, false, false, false, false, false, 0);
      } catch (e) { /* si no se puede, se abre igual */ }
    }
  }

  function aplicarCerrado() {
    try {
      sp.browser.setFocused(false);
      sp.browser.executeJavaScript(
        "window.dispatchEvent(new CustomEvent('skymp5-client:browserUnfocused', {}))");
    } catch (e) { /* da igual */ }
    if (QUITAR_MOVIMIENTO) {
      try {
        sp.Game.enablePlayerControls(true, false, false, false, false, false, false, false, 0);
      } catch (e) { /* da igual */ }
    }
  }

  function abrir(avisarAlPanel) {
    if (!puesto) inyectar();
    abierto = true;
    aplicarAbierto();
    if (avisarAlPanel !== false) decirAlPanel('abrir');
  }

  function cerrar(avisarAlPanel) {
    abierto = false;
    aplicarCerrado();
    if (avisarAlPanel !== false) decirAlPanel('cerrar');
  }

  function alternar() { if (abierto) cerrar(); else abrir(); }

  /* ------------------------------------------------------------------ la tecla */

  /**
   * Por que se ignora la tecla justo despues de una pantalla de carga.
   *
   * El mod de inventario del servidor documenta un cuelgue real al abrir su
   * panel mientras el mundo todavia se estaba asentando, y que un margen fijo
   * desde el arranque no bastaba con cargas lentas. La solucion que les
   * funciono, y que se copia aqui, es mirar la pantalla de carga de verdad y
   * esperar un rato mas despues de que se cierre.
   */
  function sePuedeAbrir() {
    if (pantallaDeCarga) return false;
    var desde = cargaTerminoEn !== null ? cargaTerminoEn : arranque;
    if (Date.now() - desde < MARGEN_CARGA) return false;
    try { if (sp.Ui.isMenuOpen('Console')) return false; } catch (e) { /* seguimos */ }
    return true;
  }

  /* ---------------------------------------------------------------------
   * COMO SE LEE LA TECLA, Y POR QUE ASI
   *
   * Durante un tiempo esto era solo sp.on('buttonEvent'), que es lo evidente.
   * Y fallaba: a veces habia que pulsar F3 dos o tres veces para que el panel
   * saliera.
   *
   * El cliente de SkyMP de este servidor da la pista: en todo el archivo hay
   * UNA sola llamada a buttonEvent, y no la usa para teclas. Todo su manejo de
   * teclado —el inventario con F2 incluido— pasa por un servicio que SONDEA:
   * mira en cada vuelta si la tecla esta pulsada. Si los que hicieron el
   * cliente prefirieron sondear, por algo sera.
   *
   * Asi que aqui se hace lo mismo, y ademas se deja buttonEvent puesto como
   * refuerzo: si alguno de los dos no llega, el otro si. Para que no cuenten
   * la misma pulsacion dos veces hay una ventana de descarte; sin ella, con
   * los dos caminos funcionando, la ventana se abriria y se cerraria al
   * instante y pareceria que la tecla no hace nada.
   * --------------------------------------------------------------------- */
  var teclaPulsadaAntes = false;
  var ultimaPulsacion = 0;
  var abrirCuandoSePueda = false;
  var DESCARTE = 250;          // ms en los que una segunda senal es la misma

  function pulsacionDeTecla() {
    var ahora = Date.now();
    if (ahora - ultimaPulsacion < DESCARTE) return;   // ya la hemos atendido
    ultimaPulsacion = ahora;

    if (abierto) { cerrar(); return; }

    if (!sePuedeAbrir()) {
      /* Antes esto se tragaba la pulsacion y no pasaba nada: pulsabas y el
         juego no respondia, sin decir por que. Ahora se apunta y se abre en
         cuanto el mundo esta listo, que es lo que la persona queria. */
      abrirCuandoSePueda = true;
      apuntar('todavia se esta cargando el mundo: se abrira en cuanto se pueda');
      return;
    }
    abrir();
  }

  /** El sondeo. Una llamada nativa por cuadro, que no es nada. */
  function mirarLaTecla() {
    var pulsada = false;
    try {
      pulsada = !!sp.Input.isKeyPressed(TECLA);
    } catch (e) {
      return;                  // no hay Input: queda buttonEvent
    }
    if (pulsada && !teclaPulsadaAntes) pulsacionDeTecla();
    teclaPulsadaAntes = pulsada;
  }

  // El refuerzo. Si el sondeo funciona, la ventana de descarte lo ignora.
  sp.on('buttonEvent', function (e) {
    if (!e || !e.isDown || e.isRepeating) return;
    if (e.code !== TECLA) return;
    encolar(pulsacionDeTecla);
  });

  /* ---------------------------------------------------------------------
   * ESCUCHAR EL GRAFO DE ANIMACION DEL JUGADOR
   *
   * Un solo enganche para dos cosas:
   *
   *   SALTAR CORTA LA ANIMACION. Se engancha al evento del salto y no a la
   *   tecla, porque la tecla se puede cambiar en las opciones del juego y el
   *   evento no: saltes como saltes, por ahi pasa.
   *
   *   Y EL JUEGO AVISA DE QUE LA POSE SE ACABO, aunque no lo sepa. Skyrim no
   *   manda ningun evento de "he terminado", pero si manda el de lo SIGUIENTE
   *   que hace el cuerpo: empezar a andar, atacar, desenfundar. Si llega uno
   *   de esos, la pose que habia ya no esta puesta, y el mod no tiene por que
   *   seguir diciendo que suena.
   *
   * Lo que manda este mod pasa tambien por aqui (SkyMP engancha la misma
   * funcion), asi que se distingue con la marca de enviarAlGrafo. Sin eso, la
   * animacion se daria por terminada en el instante de lanzarla.
   *
   * El enganche solo APUNTA. Actuar se hace en el siguiente update, que es
   * donde se puede llamar al juego; hacerlo aqui dentro daria el error de
   * "can't be called in this context", igual que en los mensajes del
   * navegador.
   * --------------------------------------------------------------------- */
  var haSaltado = false;
  var elJuegoHaTomadoElControl = false;

  try {
    sp.hooks.sendAnimationEvent.add({
      enter: function (ctx) {
        if (ctx.selfId !== FORMID_JUGADOR) return;
        var evento = ctx.animEventName || '';

        // Lo nuestro no cuenta como que el juego haga otra cosa.
        if (mandandoNosotros || loMandamosNosotros(evento)) return;

        if (evento.indexOf('Jump') === 0) {
          haSaltado = true;
          return;
        }
        elJuegoHaTomadoElControl = true;
      },
      leave: function () { }
    }, FORMID_JUGADOR, FORMID_JUGADOR);
    apuntar('escuchando el grafo de animacion');
  } catch (e) {
    apuntar('no se pudo enganchar al grafo: ' + e);
  }

  /** Si has saltado y habia algo puesto, se corta. */
  function vigilarElSalto() {
    if (!haSaltado) return;
    haSaltado = false;
    if (!PARAR_AL_SALTAR) return;
    if (!enMarcha && !Bucle.activo() && !esperandoParaCambiar) {
      return;                  // no habia nada que cortar
    }
    apuntar('salto: se corta la animacion');
    pedirParar('salto');
  }

  /**
   * Da por terminada la pose cuando ya no puede seguir puesta.
   *
   * Por lo que hace el jugador, o por tiempo si no hace nada. Las dos hacen
   * falta: moverse se nota al momento pero no siempre pasa, y la caducidad
   * tarda pero no falla nunca.
   *
   * Nada de esto toca una animacion viva: con bucle no caduca —el bucle la
   * vuelve a poner—, y mientras se espera al arma o el turno del relevo hay
   * una pose en camino que no se puede dar por terminada todavia.
   */
  function vigilarElFin() {
    var enElAire = esperandoParaCambiar;

    if (elJuegoHaTomadoElControl) {
      elJuegoHaTomadoElControl = false;
      /* Con un margen desde que se lanzo. Justo despues de pulsar, el juego
         suele mandar cosas del movimiento que se acaba de cortar —venias
         andando— y sin margen se limpiaria la pose recien puesta. */
      if (LIMPIAR_AL_MOVERSE && enMarcha && !enElAire && !Bucle.activo() &&
          Date.now() - enMarchaDesde >= GRACIA_TRAS_LANZAR) {
        darPorTerminada('el jugador se ha puesto a otra cosa');
        return;
      }
    }

    if (DURACION_MAXIMA > 0 && enMarcha && !enElAire && !Bucle.activo() &&
        Date.now() - enMarchaDesde >= DURACION_MAXIMA) {
      darPorTerminada('ha pasado de sobra el tiempo que podia durar');
    }
  }

  sp.on('menuOpen', function (e) {
    if (e && e.name === 'Loading Menu') {
      pantallaDeCarga = true;
      cargaTerminoEn = null;
    }
  });

  sp.on('menuClose', function (e) {
    if (e && e.name === 'Loading Menu') {
      pantallaDeCarga = false;
      cargaTerminoEn = Date.now();
    }
  });

  /* --------------------------------------------- lo que sube desde la pagina */

  sp.on('browserMessage', function (e) {
    var crudo = e && e.arguments && e.arguments[0];
    if (typeof crudo !== 'string') return;

    /* La interfaz de SkyMP avisa con esto cuando su pagina termina de cargar.
       No es un mensaje nuestro, pero nos llega igual, y es exactamente la
       senal que hace falta: la pagina es nueva, o sea que el panel que
       habiamos metido ya no esta. Se vuelve a poner. */
    if (crudo === 'front-loaded') {
      puesto = false;
      encolar(function () {
        inyectar();
        if (abierto) decirAlPanel('abrir');
      });
      return;
    }

    if (crudo.indexOf('animplayer:') === -1) return;

    var mensaje;
    try { mensaje = JSON.parse(crudo); } catch (err) { return; }
    if (!mensaje || !mensaje.type) return;

    switch (mensaje.type) {
      case 'animplayer:reproducir':
        // A la cola: aqui dentro no se puede llamar al juego.
        encolar(function () {
          var peticion = {
            evento: mensaje.data && mensaje.data.evento,
            quien: FORMID_JUGADOR,
            origen: 'interfaz'
          };
          if (!pedirAnimacion(peticion)) return;
          // La casilla del panel viene con la peticion: si esta marcada, esta
          // misma animacion se queda repitiendose; si no, se corta el bucle
          // anterior, porque acabas de pedir otra cosa.
          if (mensaje.data && mensaje.data.bucle) Bucle.poner(peticion);
          else Bucle.quitar();
        });
        break;

      case 'animplayer:favorito':
        /* Pulsar una estrella no toca el juego, solo escribe un archivo, pero
           se encola igual: writePlugin va al disco y no hay ninguna prisa por
           hacerlo dentro del callback del mensaje. */
        encolar(function () {
          var d = mensaje.data || {};
          marcarFavorito(d.evento, d.activo);
        });
        break;

      case 'animplayer:bucle':
        // La casilla se marco o se desmarco con algo ya en marcha.
        encolar(function () {
          var d = mensaje.data || {};
          if (d.activo && d.evento) {
            Bucle.poner({ evento: d.evento, quien: FORMID_JUGADOR, origen: 'interfaz' });
          } else {
            Bucle.quitar();
          }
        });
        break;

      case 'animplayer:parar':
        encolar(function () { pedirParar('interfaz'); });
        break;

      case 'animplayer:reiniciar':
        encolar(function () { pedirReiniciar('interfaz'); });
        break;

      case 'animplayer:cerrado':
        // El panel se cerro solo: con la X, con Esc, o porque SkyMP le quito el
        // foco al navegador. Hay que devolver el foco y el movimiento al juego.
        // El estado, ya; el efecto, en la cola (ver aplicarAbierto).
        if (abierto) { abierto = false; encolar(aplicarCerrado); }
        break;

      case 'animplayer:abierto':
        // El panel se abrio desde la pagina. Hay que hacer lo demas: quitarle
        // el movimiento al personaje y apuntar que esta abierto. No se le
        // vuelve a decir al panel que se abra, que ya lo esta.
        if (!abierto) { abierto = true; encolar(aplicarAbierto); }
        break;

      case 'animplayer:falta':
        // La pagina ha contestado que el panel no esta. Se vuelve a poner y se
        // le repite lo que se le estaba pidiendo.
        apuntar('el panel no estaba en la pagina: se vuelve a poner');
        puesto = false;
        encolar(function () {
          inyectar();
          var querian = (mensaje.data && mensaje.data.querian) || 'abrir';
          decirAlPanel(querian);
        });
        break;

      case 'animplayer:listo':
        apuntar('el panel responde con ' +
                ((mensaje.data && mensaje.data.animaciones) || 0) + ' animaciones');
        break;
    }
  });

  /* =======================================================================
   * CAPA 6 — LA PUERTA PARA OTROS MODS
   * =======================================================================
   *
   * Para que otro plugin pueda hacer que el personaje toque el laud sin saber
   * nada de como funciona esto por dentro:
   *
   *     var ap = skyrimPlatform.storage.AnimPlayer;
   *     if (ap) ap.reproducir('IdleLuteStart', { bucle: true });
   *
   * Se publica en dos sitios, y los dos apuntan al mismo objeto:
   *
   *   sp.storage.AnimPlayer   Es la via buena. storage es el objeto que
   *                           SkyrimPlatform comparte entre todos los plugins
   *                           y que sobrevive a las recargas en caliente. Es
   *                           donde el propio cliente de SkyMP deja las cosas
   *                           que otros tienen que poder tocar.
   *
   *   globalThis.AnimPlayer   Lo mismo, por comodidad.
   *
   * REGLA IMPORTANTE PARA QUIEN LLAME
   *   No mires si existe al cargar tu plugin: el orden de carga no esta
   *   garantizado y puede que AnimPlayer todavia no haya arrancado. Miralo en
   *   el momento de usarlo, dentro de un update, un tick o lo que sea.
   *
   * TODO SE ENCOLA
   *   Cualquier cosa que pidas por aqui se ejecuta en el siguiente update, no
   *   en el momento. Es a proposito: asi se puede llamar desde donde sea, y en
   *   particular desde el callback de un mensaje del navegador o de una
   *   peticion HTTP, donde llamar al juego da el error "can't be called in
   *   this context". El retraso es un cuadro, no se nota.
   *
   *   Lo que devuelven las funciones es por tanto "he aceptado la peticion",
   *   no "ya esta hecho". Si te hace falta saber que ha pasado de verdad,
   *   apuntate con alReproducir.
   * ======================================================================= */

  /**
   * Acepta las dos formas de pedir una animacion:
   *     reproducir('IdleLuteStart')
   *     reproducir('IdleLuteStart', { bucle: true })
   *     reproducir({ evento: 'IdleLuteStart', quien: 0x14, origen: 'bardo' })
   */
  function normalizarPeticion(algo, opciones) {
    var o = opciones || {};
    var p = (typeof algo === 'string') ? { evento: algo } : (algo || {});
    return {
      evento: String(p.evento || ''),
      quien: p.quien || o.quien || FORMID_JUGADOR,
      origen: String(p.origen || o.origen || 'otro mod'),
      bucle: !!(p.bucle || o.bucle)
    };
  }

  var API = {
    /* Sube si alguna vez cambia algo de forma incompatible, para que quien
       llame pueda comprobarlo antes de fiarse. */
    version: 1,

    /**
     * Reproduce una animacion.
     * @returns true si la peticion es valida y se ha encolado.
     */
    reproducir: function (algo, opciones) {
      var p = normalizarPeticion(algo, opciones);
      if (!p.evento) return false;
      encolar(function () {
        if (!pedirAnimacion(p)) return;
        if (p.bucle) Bucle.poner(p);
        else Bucle.quitar();
      });
      return true;
    },

    /** Corta la animacion, el bucle incluido, y levanta de la silla o la cama. */
    parar: function (quien) {
      encolar(function () { pedirParar('otro mod', quien); });
      return true;
    },

    /**
     * Desatasca al personaje: la parada de siempre, mas devolverle el
     * movimiento, los controles y la colision, y recargarlo.
     * Para cuando una animacion se queda colgada y "parar" no basta.
     */
    reiniciar: function (quien) {
      encolar(function () { pedirReiniciar('otro mod', quien); });
      return true;
    },

    /**
     * Pone o quita el bucle.
     *     bucle('IdleLuteStart')   lo pone en esa
     *     bucle(false)             lo quita
     * Poner el bucle NO reproduce: solo dice que se repita. Para empezar,
     * reproducir(algo, { bucle: true }).
     */
    bucle: function (algo) {
      if (!algo) { encolar(function () { Bucle.quitar(); }); return true; }
      var p = normalizarPeticion(algo);
      if (!p.evento) return false;
      encolar(function () { Bucle.poner(p); });
      return true;
    },

    /** El evento que hay puesto ahora mismo, o null.
     *
     *  Null tambien cuando el mod ha dado la pose por terminada: el juego no
     *  avisa de que una animacion acaba, asi que se deduce (ver vigilarElFin).
     *  Puede que el personaje siga con la ultima postura puesta y esto diga ya
     *  que no hay nada; es lo mas cerca que se puede estar de la verdad. */
    enMarcha: function () { return enMarcha; },

    /** El evento que se esta repitiendo ahora mismo, o null. */
    enBucle: function () {
      return Bucle.activo() ? Bucle.peticion.evento : null;
    },

    /** Si un evento esta en el catalogo. Ojo: uno que no este puede existir
     *  igualmente en el juego; esto solo dice si AnimPlayer lo conoce. */
    existe: function (evento) {
      return !!porEvento[String(evento)];
    },

    /** La ficha de un evento, o null. */
    ficha: function (evento) {
      return porEvento[String(evento)] || null;
    },

    /**
     * Busca igual que la barra del panel: por nombre, por evento y por
     * palabras en espanol. Todas las palabras que escribas tienen que estar.
     *     buscar('laud')  ->  [{ evento, nombre, categoria, sincroniza }, ...]
     */
    buscar: function (texto, limite) {
      var partes = sinAcentos(texto).trim().split(/\s+/);
      var tope = limite || 30;
      var salida = [];
      for (var i = 0; i < catalogo.animaciones.length && salida.length < tope; i++) {
        var a = catalogo.animaciones[i];
        var vale = true;
        for (var j = 0; j < partes.length; j++) {
          if (partes[j] && a._busca.indexOf(' ' + partes[j]) === -1) {
            vale = false;
            break;
          }
        }
        if (vale) {
          salida.push({
            evento: a.evento, nombre: a.nombre, categoria: a.categoria,
            sincroniza: a.sincroniza !== false
          });
        }
      }
      return salida;
    },

    /** El catalogo entero: { version, categorias, animaciones }. */
    lista: function () { return catalogo; },

    /** Los eventos que el jugador tiene marcados como favoritos. */
    favoritos: function () { return listaFavoritos(); },

    /**
     * Pone o quita un favorito, y lo guarda en disco.
     * Se encola como todo lo demas, y despues se le manda al panel la lista
     * nueva para que las estrellas se pinten al dia.
     */
    favorito: function (evento, activo) {
      if (!evento) return false;
      encolar(function () {
        marcarFavorito(String(evento), activo !== false);
        if (puesto) inyectar();
      });
      return true;
    },

    /**
     * Registra animaciones en caliente, sin tocar el archivo de ajustes.
     * Sirve para que un mod traiga las suyas: las anade al arrancar y ya salen
     * en el panel, buscables, como las demas.
     *
     *     ap.anadir([{ evento: 'MiLaudLargo', nombre: 'Tocar el laud (largo)',
     *                  categoria: 'musica' }]);
     *
     * Las que ya estuvieran con ese mismo evento se pisan, asi que tambien
     * sirve para renombrar o recategorizar.
     * @returns cuantas han entrado.
     */
    anadir: function (animaciones) {
      if (!animaciones || !animaciones.length) return 0;
      var puestas = 0;
      for (var i = 0; i < animaciones.length; i++) {
        var f = animaciones[i];
        if (!f || !f.evento) continue;
        var ficha = {
          evento: String(f.evento),
          nombre: String(f.nombre || f.evento),
          categoria: String(f.categoria || 'mods'),
          busqueda: String(f.busqueda || ''),
          destacada: !!f.destacada,
          sincroniza: f.sincroniza === false ? false : true,
          motivo: f.motivo || '',
          origen: f.origen || 'mod'
        };
        var viejo = porEvento[ficha.evento];
        if (viejo) {
          catalogo.animaciones[catalogo.animaciones.indexOf(viejo)] = ficha;
        } else {
          catalogo.animaciones.push(ficha);
        }
        // Si trae una categoria que no existia, se declara sobre la marcha.
        var hay = false;
        for (var c = 0; c < catalogo.categorias.length; c++) {
          if (catalogo.categorias[c].clave === ficha.categoria) { hay = true; break; }
        }
        if (!hay) {
          catalogo.categorias.push({
            clave: ficha.categoria,
            nombre: ficha.categoria === 'mods' ? 'De otros mods'
              : (ficha.categoria.charAt(0).toUpperCase() + ficha.categoria.slice(1)),
            busqueda: ''
          });
        }
        puestas++;
      }
      if (!puestas) return 0;
      reconstruirIndice();
      // Y que el panel se entere. inyectar vuelve a mandarle el catalogo; si ya
      // estaba puesto, solo recarga la lista.
      if (puesto) inyectar();
      apuntar('otro mod ha anadido ' + puestas + ' animaciones');
      return puestas;
    },

    /** Avisa cada vez que se reproduce algo, venga de donde venga (el panel,
     *  la tecla, otro mod, o una vuelta del bucle: mira peticion.origen).
     *  Devuelve la funcion para dejar de escuchar. */
    alReproducir: function (cb) {
      return apuntarObservador(observadoresReproducir, cb);
    },

    /** Lo mismo para cuando se para. */
    alParar: function (cb) {
      return apuntarObservador(observadoresParar, cb);
    },

    abrirPanel: function () { encolar(function () { abrir(); }); return true; },
    cerrarPanel: function () { encolar(function () { cerrar(); }); return true; },
    panelAbierto: function () { return abierto; }
  };

  try { sp.storage.AnimPlayer = API; } catch (e) { apuntar('sin storage: ' + e); }
  try { globalThis.AnimPlayer = API; } catch (e) { /* tampoco pasa nada */ }

  /* ------------------------------------------------------------------ arranque */

  sp.once('update', function () {
    apuntar('cargado. ' + catalogo.animaciones.length + ' animaciones, ' +
            catalogo.categorias.length + ' categorias. Tecla DIK ' + TECLA +
            ', transporte "' + TRANSPORTE + '".');
    // El panel se pone ya, escondido, para que la primera pulsacion de la
    // tecla sea instantanea y no tenga que esperar a que se construya.
    inyectar();
  });
})();
