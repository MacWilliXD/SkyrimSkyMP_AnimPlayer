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
      {"evento": "pa_HugA", "nombre": "Abrazar a alguien", "categoria": "combate", "busqueda": "Hug A"},
      {"evento": "Lever_PlayerPush", "nombre": "Accionar una palanca", "categoria": "combate", "busqueda": "Lever Push Player"},
      {"evento": "SneakStart", "nombre": "Agacharse", "categoria": "combate", "busqueda": "Sneak Start", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "MRh_SpellAimedStart", "nombre": "Apuntar con un hechizo, derecha", "categoria": "combate", "busqueda": "Cast Right Fire Forget Target Actor"},
      {"evento": "MLh_SpellAimedStart", "nombre": "Apuntar con un hechizo, izquierda", "categoria": "combate", "busqueda": "Cast Left Fire Forget Target Actor"},
      {"evento": "attackStart", "nombre": "Atacar", "categoria": "combate", "busqueda": "Normal Attack"},
      {"evento": "attackStart_MC_1HMRight", "nombre": "Atacar con la derecha (una mano)", "categoria": "combate", "busqueda": "Attack Right Side"},
      {"evento": "attackStartLeftHand", "nombre": "Atacar con la izquierda", "categoria": "combate", "busqueda": "Left Hand Attack"},
      {"evento": "attackStart_MC_1HMLeft", "nombre": "Atacar con la izquierda (una mano)", "categoria": "combate", "busqueda": "Attack Left Side"},
      {"evento": "attackStartDualWield", "nombre": "Atacar con las dos armas", "categoria": "combate", "busqueda": "Dual Wield Power Attack"},
      {"evento": "attackPowerStartRightLeftHand", "nombre": "Ataque potente a la derecha, con la izquierda", "categoria": "combate", "busqueda": "Left Hand Power Attack Right"},
      {"evento": "attackPowerStartLeftLeftHand", "nombre": "Ataque potente a la izquierda, con la izquierda", "categoria": "combate", "busqueda": "Left Hand Power Attack Left"},
      {"evento": "attackPowerStart_MC_1HMRight", "nombre": "Ataque potente con la derecha (una mano)", "categoria": "combate", "busqueda": "Right Power Attack"},
      {"evento": "attackPowerStart_MC_1HMLeft", "nombre": "Ataque potente con la izquierda (una mano)", "categoria": "combate", "busqueda": "Left Power Attack"},
      {"evento": "attackPowerStartDualWield", "nombre": "Ataque potente con las dos armas", "categoria": "combate", "busqueda": "Dual Wield Special Power Attack"},
      {"evento": "attackPowerStartInPlaceLeftHand", "nombre": "Ataque potente en el sitio, con la izquierda", "categoria": "combate", "busqueda": "Left Hand Power Attack"},
      {"evento": "attackPowerStartBackLeftHand", "nombre": "Ataque potente hacia atrás, con la izquierda", "categoria": "combate", "busqueda": "Left Hand Power Attack Back"},
      {"evento": "attackPowerStartLeft", "nombre": "Ataque potente hacia la izquierda", "categoria": "combate", "busqueda": "Power Attack Left"},
      {"evento": "JumpLandEnd", "nombre": "Aterrizar", "categoria": "combate", "busqueda": "Jump Soft End"},
      {"evento": "JumpLandDirectional", "nombre": "Aterrizar de lado", "categoria": "combate", "busqueda": "Jump Land Directional"},
      {"evento": "DragonMountExit", "nombre": "Bajar del dragón", "categoria": "combate", "busqueda": "Dragon Dismount"},
      {"evento": "Ground_Dismount_Dragon", "nombre": "Bajar del dragón en tierra", "categoria": "combate", "busqueda": "Ground Dismount Dragon NPC"},
      {"evento": "JumpFall", "nombre": "Caer", "categoria": "combate", "busqueda": "Jump Fall"},
      {"evento": "WeapOutRightReplaceForceEquip", "nombre": "Cambiar el arma de la derecha", "categoria": "combate", "busqueda": "Both Hands Change", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MC_WeapOutRightReplaceForceEquip", "nombre": "Cambiar el arma de la derecha (2)", "categoria": "combate", "busqueda": "Weapon Right Hand Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapOutLeftReplaceForceEquip", "nombre": "Cambiar el arma de la izquierda", "categoria": "combate", "busqueda": "Staff Magic Shield Torch AND Weap Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "ShoutSprintLongStart", "nombre": "Carrera del Torbellino, larga", "categoria": "combate", "busqueda": "Voice Whirlwind Sprint Medium"},
      {"evento": "ShoutSprintMediumStart", "nombre": "Carrera del Torbellino, media", "categoria": "combate", "busqueda": "Voice Whirlwind Sprint Short"},
      {"evento": "ShoutSprintLongestStart", "nombre": "Carrera del Torbellino, muy larga", "categoria": "combate", "busqueda": "Voice Whirlwind Sprint Long"},
      {"evento": "attackPowerStartH2HCombo", "nombre": "Combinación de puñetazos", "categoria": "combate", "busqueda": "Right H2 H Combo Power Attack"},
      {"evento": "RitualSpellOut", "nombre": "Cortar el hechizo ritual", "categoria": "combate", "busqueda": "Interrupt Right Ritual Spell"},
      {"evento": "pa_OffsetBoundStandingCut", "nombre": "Cortarle las ataduras a alguien", "categoria": "combate", "busqueda": "Offset Bound Standing Cut"},
      {"evento": "pa_WW_CutWrist", "nombre": "Cortarse la muñeca", "categoria": "combate", "busqueda": "Were Wolf Cut Wrist"},
      {"evento": "moveStop", "nombre": "Dejar de andar", "categoria": "combate", "busqueda": "Character Move Stop", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "blockStop", "nombre": "Dejar de bloquear", "categoria": "combate", "busqueda": "Stop Blocking"},
      {"evento": "SprintStop", "nombre": "Dejar de correr", "categoria": "combate", "busqueda": "Sprint Root Stop"},
      {"evento": "bleedOutStop", "nombre": "Dejar de desangrarse", "categoria": "combate", "busqueda": "Bleedout Stop"},
      {"evento": "turnStop", "nombre": "Dejar de girar", "categoria": "combate", "busqueda": "Character Turn Stop", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SwimStop", "nombre": "Dejar de nadar", "categoria": "combate", "busqueda": "Swim Stop"},
      {"evento": "MountedSwimStop", "nombre": "Dejar de nadar montado", "categoria": "combate", "busqueda": "Mounted Swim Stop"},
      {"evento": "bleedOutStart", "nombre": "Desangrarse", "categoria": "combate", "busqueda": "Bleedout Start"},
      {"evento": "WeapEquip", "nombre": "Desenvainar", "categoria": "combate", "busqueda": "Attack Left Equip Weapon", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapSoloEquip", "nombre": "Desenvainar (sin nada más)", "categoria": "combate", "busqueda": "Left H2 H Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "HorseExit", "nombre": "Desmontar del caballo", "categoria": "combate", "busqueda": "Dismount"},
      {"evento": "HorseExitSwim", "nombre": "Desmontar del caballo en el agua", "categoria": "combate", "busqueda": "Dismount Swim"},
      {"evento": "Ragdoll", "nombre": "Desplomarse como un muñeco", "categoria": "combate", "busqueda": "NPC Knock Down"},
      {"evento": "bowAttackStart", "nombre": "Disparar el arco", "categoria": "combate", "busqueda": "Bow Attack"},
      {"evento": "crossbowAttackStart", "nombre": "Disparar la ballesta", "categoria": "combate", "busqueda": "crossbow Attack Start"},
      {"evento": "crossbowDwarvenAttackStart", "nombre": "Disparar la ballesta dwemer", "categoria": "combate", "busqueda": "crossbow Dwarven Attack Start"},
      {"evento": "moveStart", "nombre": "Echar a andar", "categoria": "combate", "busqueda": "Character Move Start", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SprintStart", "nombre": "Echar a correr", "categoria": "combate", "busqueda": "Sprint Start"},
      {"evento": "ExecutionNextClip", "nombre": "Ejecución: siguiente parte", "categoria": "combate", "busqueda": "00 Next Clip"},
      {"evento": "shoutStart", "nombre": "Empezar un Grito", "categoria": "combate", "busqueda": "Voice Start"},
      {"evento": "MC_shoutStart", "nombre": "Empezar un Grito (2)", "categoria": "combate", "busqueda": "Mounted Voice"},
      {"evento": "RitualSpellStart", "nombre": "Empezar un hechizo ritual", "categoria": "combate", "busqueda": "Cast Left Ritual Fire And Forget Self"},
      {"evento": "idleRitualSpellStart", "nombre": "Empezar un hechizo ritual (pose)", "categoria": "combate", "busqueda": "Ritual Spell Start"},
      {"evento": "IdleCombatShieldStart", "nombre": "En guardia, con el escudo", "categoria": "combate", "busqueda": "Civil War Shield Cheer"},
      {"evento": "IdleCombatStretchingStart", "nombre": "En guardia, estirándose", "categoria": "combate", "busqueda": "Combat Idle Stretching"},
      {"evento": "IdleCombatLookingAroundStart", "nombre": "En guardia, mirando alrededor", "categoria": "combate", "busqueda": "Combat Idle Looking Around"},
      {"evento": "IdleCombatSpecialStart", "nombre": "En guardia, pose especial", "categoria": "combate", "busqueda": "Combat Idle Special"},
      {"evento": "IdleCombatWeaponCheckStart", "nombre": "En guardia, revisando el arma", "categoria": "combate", "busqueda": "Combat Idle Weapon Check"},
      {"evento": "blockHitStart", "nombre": "Encajar un golpe con el bloqueo", "categoria": "combate", "busqueda": "Block Hit"},
      {"evento": "UnequipNoAnim", "nombre": "Envainar sin animación", "categoria": "combate", "busqueda": "Force Sheathe", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "FlinchStart", "nombre": "Estremecerse", "categoria": "combate", "busqueda": "Flinch"},
      {"evento": "pa_ExtractWerewolfSpirit", "nombre": "Extraer el espíritu del hombre lobo", "categoria": "combate", "busqueda": "Extract Werewolf Spirit"},
      {"evento": "turnRight", "nombre": "Girar a la derecha", "categoria": "combate", "busqueda": "Character Turn Right"},
      {"evento": "turnLeft", "nombre": "Girar a la izquierda", "categoria": "combate", "busqueda": "Character Turn Left"},
      {"evento": "bashFail", "nombre": "Golpe de escudo fallido", "categoria": "combate", "busqueda": "Bash Fail"},
      {"evento": "BashFail", "nombre": "Golpe de escudo fallido (2)", "categoria": "combate", "busqueda": "Bash Fail"},
      {"evento": "bashPowerStart", "nombre": "Golpe de escudo potente", "categoria": "combate", "busqueda": "Power Bash"},
      {"evento": "pa_KillingBlow", "nombre": "Golpe de gracia", "categoria": "combate", "busqueda": "1 HM Kill Move Bleed Out Kill"},
      {"evento": "StaffBashRelease", "nombre": "Golpear con el bastón", "categoria": "combate", "busqueda": "Staff Bash Release"},
      {"evento": "bashStart", "nombre": "Golpear con el escudo", "categoria": "combate", "busqueda": "Bow Bash"},
      {"evento": "shoutReleaseSlowTime", "nombre": "Grito: Tiempo Lento", "categoria": "combate", "busqueda": "Voice Release Slow Time"},
      {"evento": "torchUnequip", "nombre": "Guardar la antorcha", "categoria": "combate", "busqueda": "Removed"},
      {"evento": "MLh_SpellAimedConcentrationStart", "nombre": "Hechizo de concentración, izquierda", "categoria": "combate", "busqueda": "Cast Left Concentration Aimed"},
      {"evento": "MRh_Equipped_Event", "nombre": "Hechizo equipado en la derecha", "categoria": "combate", "busqueda": "Interrupt Right", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MLh_Equipped_Event", "nombre": "Hechizo equipado en la izquierda", "categoria": "combate", "busqueda": "Interrupt Left", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_SpellReady_Event", "nombre": "Hechizo listo en la derecha", "categoria": "combate", "busqueda": "Ready Right"},
      {"evento": "MLh_SpellReady_Event", "nombre": "Hechizo listo en la izquierda", "categoria": "combate", "busqueda": "Ready Left"},
      {"evento": "RitualSpellAimConcentrationStart", "nombre": "Hechizo ritual de concentración", "categoria": "combate", "busqueda": "Cast Left Ritual Concentration Aim"},
      {"evento": "MRh_SpellSelfStart", "nombre": "Hechizo sobre uno mismo, derecha", "categoria": "combate", "busqueda": "Cast Right Fire Forget Self"},
      {"evento": "wardAbsorb", "nombre": "La protección absorbe un hechizo", "categoria": "combate", "busqueda": "Ward Absorbed"},
      {"evento": "MRh_WardStart", "nombre": "Levantar protección con la derecha", "categoria": "combate", "busqueda": "Cast Right Ward"},
      {"evento": "MLh_WardStart", "nombre": "Levantar protección con la izquierda", "categoria": "combate", "busqueda": "Cast Left Ward"},
      {"evento": "SneakStop", "nombre": "Levantarse de agacharse", "categoria": "combate", "busqueda": "Sneak Stop", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "HorseEnter", "nombre": "Montar a caballo", "categoria": "combate", "busqueda": "Mount"},
      {"evento": "HorseEnterInstant", "nombre": "Montar a caballo (al instante)", "categoria": "combate", "busqueda": "Enter Horse Instant"},
      {"evento": "DragonMountEnter", "nombre": "Montar en el dragón", "categoria": "combate", "busqueda": "Dragon Mount"},
      {"evento": "DragonMountEnterInstant", "nombre": "Montar en el dragón (al instante)", "categoria": "combate", "busqueda": "Dragon Mount Instant"},
      {"evento": "MountedSwimStart", "nombre": "Nadar montado", "categoria": "combate", "busqueda": "Mounted Swim Start"},
      {"evento": "NPCshoutStart", "nombre": "PNJ: empezar un Grito", "categoria": "combate", "busqueda": "NPC Voice Start"},
      {"evento": "NPC_TurnRight90", "nombre": "PNJ: girar 90 grados a la derecha", "categoria": "combate", "busqueda": "NPC Turn Right90 End"},
      {"evento": "NPC_TurnToWalkRight90", "nombre": "PNJ: girar 90 grados y echar a andar", "categoria": "combate", "busqueda": "NPC Turn To Walk Right90"},
      {"evento": "MagicForceEquipRight", "nombre": "Poner magia en la derecha", "categoria": "combate", "busqueda": "Only Right Hand Changes Magic Out", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicForceEquipLeft", "nombre": "Poner magia en la izquierda", "categoria": "combate", "busqueda": "Left Magic Force Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicWeap_ForceEquip", "nombre": "Poner magia y arma", "categoria": "combate", "busqueda": "Magic Weapon Force Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "blockStart", "nombre": "Ponerse a bloquear", "categoria": "combate", "busqueda": "Bow Zoom"},
      {"evento": "SwimStart", "nombre": "Ponerse a nadar", "categoria": "combate", "busqueda": "Jump Land Swimming"},
      {"evento": "IdleCombatStart", "nombre": "Postura de combate", "categoria": "combate", "busqueda": "Combat Idle Stagger Regular"},
      {"evento": "blockAnticipateStart", "nombre": "Prepararse para bloquear", "categoria": "combate", "busqueda": "Block Anticipate"},
      {"evento": "AttackStartH2HRight", "nombre": "Puñetazo con la derecha", "categoria": "combate", "busqueda": "Attack Right H2 H"},
      {"evento": "AttackStartH2HLeft", "nombre": "Puñetazo con la izquierda", "categoria": "combate", "busqueda": "Attack Left H2 H"},
      {"evento": "attackPowerStartForwardH2HRightHand", "nombre": "Puñetazo potente hacia delante, derecha", "categoria": "combate", "busqueda": "H2 H Right Hand Power Attack"},
      {"evento": "attackPowerStartForwardH2HLeftHand", "nombre": "Puñetazo potente hacia delante, izquierda", "categoria": "combate", "busqueda": "H2 H Left Hand Power Attack"},
      {"evento": "NPC_BumpFromFront", "nombre": "Que te empujen de frente", "categoria": "combate", "busqueda": "Bumped From Front"},
      {"evento": "reloadStart", "nombre": "Recargar", "categoria": "combate", "busqueda": "Reload Root"},
      {"evento": "pa_KillMoveC", "nombre": "Remate (C)", "categoria": "combate", "busqueda": "1 HM Kill Move C"},
      {"evento": "pa_KillMoveShortA", "nombre": "Remate (corto) (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Short A"},
      {"evento": "pa_KillMoveShortB", "nombre": "Remate (corto) (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Short B"},
      {"evento": "pa_KillMoveShortC", "nombre": "Remate (corto) (C)", "categoria": "combate", "busqueda": "1 HM Kill Move Short C"},
      {"evento": "pa_KillMoveShortD", "nombre": "Remate (corto) (D)", "categoria": "combate", "busqueda": "1 HM Kill Move Short D"},
      {"evento": "pa_KillMoveD", "nombre": "Remate (D)", "categoria": "combate", "busqueda": "1 HM Kill Move D"},
      {"evento": "pa_KillMoveF", "nombre": "Remate (F)", "categoria": "combate", "busqueda": "1 HM Kill Move F"},
      {"evento": "pa_KillMoveJ", "nombre": "Remate (J)", "categoria": "combate", "busqueda": "1 HM Kill Move Short J"},
      {"evento": "pa_KillMoveH2HComboA", "nombre": "Remate a puñetazos (A)", "categoria": "combate", "busqueda": "Kill Move H2 H Combo A"},
      {"evento": "pa_KillMoveH2HSlamA", "nombre": "Remate a puñetazos (A)", "categoria": "combate", "busqueda": "Kill Move H2 H Slam"},
      {"evento": "pa_KillMoveDualWieldA", "nombre": "Remate con dos armas (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Dual Wield A"},
      {"evento": "pa_KillMove2HMSteamCenturionA", "nombre": "Remate con un arma a dos manos contra un centurión dwemer (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Steam Centurion A"},
      {"evento": "pa_KillMove2HMDraugrA", "nombre": "Remate con un arma a dos manos contra un draugr (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Draugr A"},
      {"evento": "pa_KillMove2HMFalmerA", "nombre": "Remate con un arma a dos manos contra un falmer (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Falmer A"},
      {"evento": "pa_KillMove2HMFalmerB", "nombre": "Remate con un arma a dos manos contra un falmer (B)", "categoria": "combate", "busqueda": "2 HM Kill Move Falmer B"},
      {"evento": "pa_KillMove2HMSabreCatA", "nombre": "Remate con un arma a dos manos contra un gato montés (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Sabre Cat A"},
      {"evento": "pa_KillMove2HMSabreCatB", "nombre": "Remate con un arma a dos manos contra un gato montés (B)", "categoria": "combate", "busqueda": "2 HM Kill Move Sabre Cat B"},
      {"evento": "pa_KillMove2HMGiantA", "nombre": "Remate con un arma a dos manos contra un gigante (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Giant A"},
      {"evento": "pa_KillMove2HMWolfA", "nombre": "Remate con un arma a dos manos contra un lobo (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Wolf A"},
      {"evento": "pa_KillMove2HMWolfB", "nombre": "Remate con un arma a dos manos contra un lobo (B)", "categoria": "combate", "busqueda": "2 HM Kill Move Wolf B"},
      {"evento": "pa_KillMove2HMBearA", "nombre": "Remate con un arma a dos manos contra un oso (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Bear A"},
      {"evento": "pa_KillMove2HMBearB", "nombre": "Remate con un arma a dos manos contra un oso (B)", "categoria": "combate", "busqueda": "2 HM Kill Move Bear B"},
      {"evento": "pa_KillMove2HMTrollA", "nombre": "Remate con un arma a dos manos contra un trol (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Troll A"},
      {"evento": "pa_KillMove2HMTrollB", "nombre": "Remate con un arma a dos manos contra un trol (B)", "categoria": "combate", "busqueda": "2 HM Kill Move Troll B"},
      {"evento": "pa_KillMove2HMHagravenA", "nombre": "Remate con un arma a dos manos contra una bruja cuervo (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Hagraven A"},
      {"evento": "pa_KillMove2HMSprigganA", "nombre": "Remate con un arma a dos manos contra una spriggan (A)", "categoria": "combate", "busqueda": "2 HM Kill Move Spriggan A"},
      {"evento": "pa_KillMove1HMSteamCenturionA", "nombre": "Remate con un arma de una mano contra un centurión dwemer (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Steam Centurion A"},
      {"evento": "pa_KillMove1HMSteamCenturionB", "nombre": "Remate con un arma de una mano contra un centurión dwemer (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Steam Centurion B"},
      {"evento": "pa_KillMove1HMFalmerA", "nombre": "Remate con un arma de una mano contra un falmer (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Falmer A"},
      {"evento": "pa_KillMove1HMFalmerB", "nombre": "Remate con un arma de una mano contra un falmer (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Falmer B"},
      {"evento": "pa_KillMove1HMFalmerC", "nombre": "Remate con un arma de una mano contra un falmer (C)", "categoria": "combate", "busqueda": "1 HM Kill Move Falmer C"},
      {"evento": "pa_KillMove1HMGiantBleedOutA", "nombre": "Remate con un arma de una mano contra un gigante", "categoria": "combate", "busqueda": "1 HM Kill Move Giant Bleed Out A"},
      {"evento": "pa_KillMove1HMGiantB", "nombre": "Remate con un arma de una mano contra un gigante (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Giant B"},
      {"evento": "pa_KillMove1HMWolfA", "nombre": "Remate con un arma de una mano contra un lobo (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Wolf A"},
      {"evento": "pa_KillMove1HMWolfB", "nombre": "Remate con un arma de una mano contra un lobo (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Wolf B"},
      {"evento": "pa_KillMove1HMBearB", "nombre": "Remate con un arma de una mano contra un oso (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Bear B"},
      {"evento": "pa_KillMove1HMTrollB", "nombre": "Remate con un arma de una mano contra un trol (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Troll B"},
      {"evento": "pa_KillMove1HMHagravenA", "nombre": "Remate con un arma de una mano contra una bruja cuervo (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Hagraven A"},
      {"evento": "pa_KillMove1HMHagravenB", "nombre": "Remate con un arma de una mano contra una bruja cuervo (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Hagraven B"},
      {"evento": "pa_KillMove1HMSprigganA", "nombre": "Remate con un arma de una mano contra una spriggan (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Spriggan A"},
      {"evento": "pa_KillMove1HMSprigganB", "nombre": "Remate con un arma de una mano contra una spriggan (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Spriggan B"},
      {"evento": "pa_2HWKillMoveA", "nombre": "Remate con un arma pesada (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Decap A"},
      {"evento": "pa_KillMove2HWSabreCatA", "nombre": "Remate con un arma pesada contra un gato montés (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Sabre Cat"},
      {"evento": "pa_KillMove2HWGiantA", "nombre": "Remate con un arma pesada contra un gigante (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Giant A"},
      {"evento": "pa_KillMove2HWWolfA", "nombre": "Remate con un arma pesada contra un lobo (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Wolf A"},
      {"evento": "pa_KillMove2HWBearA", "nombre": "Remate con un arma pesada contra un oso (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Bear A"},
      {"evento": "pa_KillMove2HWTrollA", "nombre": "Remate con un arma pesada contra un trol (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Troll A"},
      {"evento": "pa_KillMove2HWSprigganA", "nombre": "Remate con un arma pesada contra una spriggan (A)", "categoria": "combate", "busqueda": "2 HW Kill Move Spriggan A"},
      {"evento": "pa_KillMoveDraugr", "nombre": "Remate contra un draugr", "categoria": "combate", "busqueda": "1 HM Kill Move Draugr A"},
      {"evento": "pa_KillMoveDraugrB", "nombre": "Remate contra un draugr (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Draugr B"},
      {"evento": "pa_KillMoveDraugrShortA", "nombre": "Remate contra un draugr (corto) (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Draugr Short A"},
      {"evento": "pa_KillMoveSabreCat", "nombre": "Remate contra un gato montés", "categoria": "combate", "busqueda": "1 HM Kill Move Sabre Cat"},
      {"evento": "pa_KillMoveSabreCatShortA", "nombre": "Remate contra un gato montés (corto) (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Sabre Cat Short A"},
      {"evento": "pa_KillMoveSabreCatShortB", "nombre": "Remate contra un gato montés (corto) (B)", "categoria": "combate", "busqueda": "1 HM Kill Move Sabre Cat Short B"},
      {"evento": "pa_KillMoveGiantA", "nombre": "Remate contra un gigante (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Giant A"},
      {"evento": "pa_KillMoveBearA", "nombre": "Remate contra un oso (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Bear A"},
      {"evento": "pa_KillMoveTrollA", "nombre": "Remate contra un trol (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Troll A"},
      {"evento": "pa_KillMove1HMSpiderSmashA", "nombre": "Remate: aplastar con un arma de una mano contra una araña (A)", "categoria": "combate", "busqueda": "1 HM Kill Move Spider Smash A"},
      {"evento": "pa_KillMove2HMStabA", "nombre": "Remate: apuñalar con un arma a dos manos", "categoria": "combate", "busqueda": "2 HM Kill Move Stab A"},
      {"evento": "pa_KillMove1HMDragonRodeoStabShort", "nombre": "Remate: apuñalar con un arma de una mano contra un dragón (corto)", "categoria": "combate", "busqueda": "1 HM Kill Move Dragon Rodeo Stab Short"},
      {"evento": "pa_KillMove1HMSpiderStabA", "nombre": "Remate: apuñalar con un arma de una mano contra una araña", "categoria": "combate", "busqueda": "1 HM Kill Move Spider Stab A"},
      {"evento": "pa_KillMove2HMChaurusFlyerStabDown", "nombre": "Remate: apuñalar hacia abajo con un arma a dos manos contra un chaurus alado", "categoria": "combate", "busqueda": "2 HM Kill Move Chaurus Flyer"},
      {"evento": "pa_KillMove1HMBackStab", "nombre": "Remate: apuñalar por la espalda con un arma de una mano", "categoria": "combate", "busqueda": "1 HM Kill Move Back Stab"},
      {"evento": "pa_KillMove1HMVBSlowBackStab", "nombre": "Remate: apuñalar por la espalda con un arma de una mano contra un vampiro", "categoria": "combate", "busqueda": "1 HMVB Slow Back Stab"},
      {"evento": "pa_KillMoveDLC02RipHeartOut", "nombre": "Remate: arrancarle el corazón", "categoria": "combate", "busqueda": "Kill Move DLC02 Rip Heart Out"},
      {"evento": "pa_KillMove2HMDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma a dos manos", "categoria": "combate", "busqueda": "2 HM Kill Move Decap Bleed Out"},
      {"evento": "pa_KillMove1HMDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma de una mano", "categoria": "combate", "busqueda": "1 HM Kill Move Decap Bleed Out"},
      {"evento": "pa_KillMove2HWDecapBleedOut", "nombre": "Remate: decapitar al desangrado con un arma pesada", "categoria": "combate", "busqueda": "Kill Move2 HW Decap Bleed Out"},
      {"evento": "pa_KillMoveDWDecap", "nombre": "Remate: decapitar con dos armas", "categoria": "combate", "busqueda": "Kill Move Dual Wield Decap"},
      {"evento": "pa_KillMove2HMDecap", "nombre": "Remate: decapitar con un arma a dos manos", "categoria": "combate", "busqueda": "2 HM Kill Move Decap Slash"},
      {"evento": "pa_KillMove1HMDecap", "nombre": "Remate: decapitar con un arma de una mano", "categoria": "combate", "busqueda": "Kill Move Decap Slash"},
      {"evento": "pa_KillMove1HMDecapKnife", "nombre": "Remate: degollar con el cuchillo con un arma de una mano", "categoria": "combate", "busqueda": "1 HM Kill Move Decap Knife"},
      {"evento": "pa_KillMove2HMSpiderSlamA", "nombre": "Remate: estrellarlo contra el suelo con un arma a dos manos contra una araña", "categoria": "combate", "busqueda": "2 HM Kill Move Spider Slam A"},
      {"evento": "pa_KillMove2HWSpiderSlamA", "nombre": "Remate: estrellarlo contra el suelo con un arma pesada contra una araña", "categoria": "combate", "busqueda": "2 HW Kill Move Spider Slam A"},
      {"evento": "pa_KillMove2HWVBBackBreaker", "nombre": "Remate: partirle la espalda con un arma pesada contra un vampiro", "categoria": "combate", "busqueda": "2 HW Kill Move Vampire Brute"},
      {"evento": "pa_KillMove1HMChaurusFlyerKick", "nombre": "Remate: patada con un arma de una mano contra un chaurus alado", "categoria": "combate", "busqueda": "1 HM Kill Move Chaurus Flyer Kick"},
      {"evento": "pa_KillMove1HMVBSoccerKick", "nombre": "Remate: patada con un arma de una mano contra un vampiro", "categoria": "combate", "busqueda": "1 HMVB Soccer Kick"},
      {"evento": "pa_KillMoveSneakBackA", "nombre": "Remate: por la espalda, a hurtadillas (A)", "categoria": "combate", "busqueda": "1 HM Sneak Kill Back A"},
      {"evento": "pa_KillMove2HWChaurusFlyerPullDownSlash", "nombre": "Remate: tajo con arma pesada", "categoria": "combate", "busqueda": "2 HW Kill Move Chaurus Flyer"},
      {"evento": "pa_KillMove2HMDragonSlash", "nombre": "Remate: tajo con un arma a dos manos contra un dragón", "categoria": "combate", "busqueda": "2 HM Kill Move Dragon Slash"},
      {"evento": "pa_KillMove2HMVBBlockAndSlash", "nombre": "Remate: tajo con un arma a dos manos contra un vampiro", "categoria": "combate", "busqueda": "2 HM Kill Move Vampire Brute"},
      {"evento": "pa_KillMove1HMDragonRodeoSlash", "nombre": "Remate: tajo con un arma de una mano contra un dragón", "categoria": "combate", "busqueda": "1 HM Kill Move Dragon Rodeo Slash"},
      {"evento": "pa_KillMove2HWDragonSlash", "nombre": "Remate: tajo con un arma pesada contra un dragón", "categoria": "combate", "busqueda": "2 HW Kill Move Dragon Slash"},
      {"evento": "pa_KillMove2HWDragonRodeoSlash", "nombre": "Remate: tajo con un arma pesada contra un dragón", "categoria": "combate", "busqueda": "2 HW Kill Move Dragon Rodeo Slash"},
      {"evento": "MT_BreathExhaleShort", "nombre": "Resoplar", "categoria": "combate", "busqueda": "Voice Release"},
      {"evento": "CombatReady_BreathExhaleShort", "nombre": "Resoplar en guardia", "categoria": "combate", "busqueda": "Voice Release Weapon Out"},
      {"evento": "recoilLargeStart", "nombre": "Retroceder de un golpetazo", "categoria": "combate", "busqueda": "Recoil Large"},
      {"evento": "recoilStart", "nombre": "Retroceder por el golpe", "categoria": "combate", "busqueda": "Recoil"},
      {"evento": "ShdEquip", "nombre": "Sacar el escudo", "categoria": "combate", "busqueda": "shield Force Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "torchEquip", "nombre": "Sacar la antorcha", "categoria": "combate", "busqueda": "torch Force Equip"},
      {"evento": "torchForceEquip", "nombre": "Sacar la antorcha a la fuerza", "categoria": "combate", "busqueda": "Torch Equip"},
      {"evento": "Magic_Equip", "nombre": "Sacar la magia", "categoria": "combate", "busqueda": "Attack Left Equip Spell", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "Magic_Solo_Equip", "nombre": "Sacar la magia (sin nada más)", "categoria": "combate", "busqueda": "Left Magic Force Unequip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "JumpStandingStart", "nombre": "Saltar en el sitio", "categoria": "combate", "busqueda": "Jump Standing Start"},
      {"evento": "JumpDirectionalStart", "nombre": "Saltar hacia un lado", "categoria": "combate", "busqueda": "Jump Directional Start"},
      {"evento": "pa_DLC1SeranaHoldsVyrthur", "nombre": "Serana sujeta a Vyrthur", "categoria": "combate", "busqueda": "DLC1 Serana Holds Vyrthur"},
      {"evento": "attackRelease", "nombre": "Soltar el ataque", "categoria": "combate", "busqueda": "Right Attack Release"},
      {"evento": "attackReleaseL", "nombre": "Soltar el ataque con la izquierda", "categoria": "combate", "busqueda": "Left Attack Release"},
      {"evento": "bashRelease", "nombre": "Soltar el golpe de escudo", "categoria": "combate", "busqueda": "Bash Release"},
      {"evento": "MRh_SpellRelease_Event", "nombre": "Soltar el hechizo con la derecha", "categoria": "combate", "busqueda": "Magic Right Release"},
      {"evento": "MLh_SpellRelease_Event", "nombre": "Soltar el hechizo con la izquierda", "categoria": "combate", "busqueda": "Release Left"},
      {"evento": "MLH_SpellRelease_event", "nombre": "Soltar el hechizo con la izquierda (2)", "categoria": "combate", "busqueda": "Release Left"},
      {"evento": "idleRitualSpellRelease", "nombre": "Soltar el hechizo ritual (pose)", "categoria": "combate", "busqueda": "Ritual Spell Release"},
      {"evento": "swimForceEquip", "nombre": "Soltar lo que llevas al nadar", "categoria": "combate", "busqueda": "Swimming Force Equip", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_SpellTelekinesisStart", "nombre": "Telequinesis con la derecha", "categoria": "combate", "busqueda": "Cast Right Telekinesis"},
      {"evento": "MLh_SpellTelekinesisStart", "nombre": "Telequinesis con la izquierda", "categoria": "combate", "busqueda": "Cast Left Telekinesis"},
      {"evento": "bowEnd", "nombre": "Terminar con el arco", "categoria": "combate", "busqueda": "Crossbow Release During Reload"},
      {"evento": "shoutStop", "nombre": "Terminar el Grito", "categoria": "combate", "busqueda": "Voice Interrupt Root"},
      {"evento": "staggerStart", "nombre": "Trastabillar", "categoria": "combate", "busqueda": "Loose Full Body Stagger"},
      {"evento": "StaggerPlayer", "nombre": "Trastabillar (jugador)", "categoria": "combate", "busqueda": "Player Stagger"},
      {"evento": "MountedStaggerStart", "nombre": "Trastabillar montado", "categoria": "combate", "busqueda": "Mounted Stagger Start"},
      {"evento": "pa_VampireFeedStanding_Front", "nombre": "Vampiro: morder de frente", "categoria": "combate", "busqueda": "Vampire Standing Feed Front Loose"},
      {"evento": "pa_VampireFeedStanding_Back", "nombre": "Vampiro: morder por la espalda", "categoria": "combate", "busqueda": "Vampire Standing Back"},
      {"evento": "IdleDrink", "nombre": "Beber", "categoria": "comer", "busqueda": "Drink", "destacada": true},
      {"evento": "IdleDrinkFromFountain", "nombre": "Beber de la fuente", "categoria": "comer", "busqueda": "Drink Fountain"},
      {"evento": "idleDrinkingStandingStart", "nombre": "Beber de pie", "categoria": "comer", "busqueda": "Drinking Standing Start", "destacada": true},
      {"evento": "idleBarDrinkingStart", "nombre": "Beber en la barra", "categoria": "comer", "busqueda": "Bar Drinking Start"},
      {"evento": "IdleMQ201Drink", "nombre": "Beber en la fiesta", "categoria": "comer", "busqueda": "MQ201 Drink"},
      {"evento": "IdleDrinkPotion", "nombre": "Beberse una poción", "categoria": "comer", "busqueda": "Drink Potion"},
      {"evento": "IdleMQ201ToastStart", "nombre": "Brindar", "categoria": "comer", "busqueda": "MQ201 Toast Start"},
      {"evento": "IdleWarmHands", "nombre": "Calentarse las manos", "categoria": "comer", "busqueda": "Warm Hands"},
      {"evento": "IdleWarmHandsStanding", "nombre": "Calentarse las manos de pie", "categoria": "comer", "busqueda": "Warm Hands Standing", "destacada": true},
      {"evento": "IdleWarmHandsCrouched", "nombre": "Calentarse las manos en cuclillas", "categoria": "comer", "busqueda": "Warm Hands Crouched"},
      {"evento": "IdleWarmArms", "nombre": "Calentarse los brazos", "categoria": "comer", "busqueda": "Warm Arms"},
      {"evento": "idleEatingStandingStart_DLC1Vampire", "nombre": "Comer carne cruda de pie (vampiro)", "categoria": "comer", "busqueda": "Eating Standing Start Vampire Meat"},
      {"evento": "idleEatingStandingStart", "nombre": "Comer de pie", "categoria": "comer", "busqueda": "Eating Standing Start", "destacada": true},
      {"evento": "DrunkStop", "nombre": "Dejar de hacer eses", "categoria": "comer", "busqueda": "Drunk Stop"},
      {"evento": "OffsetCarryMQ201DrinkTray", "nombre": "Llevar una bandeja de bebidas", "categoria": "comer", "busqueda": "Offset Carry MQ201 Drink Tray"},
      {"evento": "OffsetCarryMQ201DrinkR", "nombre": "Llevar una copa en la mano", "categoria": "comer", "busqueda": "Offset Carry MQ201 Drink R"},
      {"evento": "DrunkStart", "nombre": "Ponerse a hacer eses", "categoria": "comer", "busqueda": "Drunk Start"},
      {"evento": "IdleTG03UseMeadBarrel", "nombre": "Servirse del barril de hidromiel", "categoria": "comer", "busqueda": "Use Mead Barrel Enter"},
      {"evento": "IdleTG03UseMeadBarrelEnterInstant", "nombre": "Servirse del barril de hidromiel (al instante)", "categoria": "comer", "busqueda": "Use Mead Barrel Enter Instant"},
      {"evento": "IdleMQ201HoldingDrinkTray", "nombre": "Sostener una bandeja de bebidas", "categoria": "comer", "busqueda": "MQ201 Holding Drink Tray"},
      {"evento": "IdleEatSoup", "nombre": "Tomar sopa", "categoria": "comer", "busqueda": "Eat Soup"},
      {"evento": "IdleFurnitureExit", "nombre": "Levantarse del mueble", "categoria": "control", "busqueda": "MQ203 Esbern Book Exit levantarse salir silla cama mueble"},
      {"evento": "IdleStopInstant", "nombre": "Parar al instante", "categoria": "control", "busqueda": "Stop Instant parar detener cancelar instante"},
      {"evento": "IdleStop", "nombre": "Parar la animación", "categoria": "control", "busqueda": "Stop Loose parar detener cancelar"},
      {"evento": "IdleForceDefaultState", "nombre": "Parar y volver a la postura normal", "categoria": "control", "busqueda": "Reset Root parar detener cancelar normal quieto", "destacada": true},
      {"evento": "OffsetStop", "nombre": "Soltar lo que lleva en las manos", "categoria": "control", "busqueda": "Offset Stop soltar dejar manos"},
      {"evento": "RF_OpenStart", "nombre": "Actitud: cercana", "categoria": "dialogo", "busqueda": "Caring"},
      {"evento": "RF_GuardedStart", "nombre": "Actitud: distante", "categoria": "dialogo", "busqueda": "Standoffish"},
      {"evento": "RF_PlayfulStart", "nombre": "Actitud: juguetona", "categoria": "dialogo", "busqueda": "Flirty"},
      {"evento": "RF_SeriousStart", "nombre": "Actitud: seria", "categoria": "dialogo", "busqueda": "Sarcastic"},
      {"evento": "RF_MoodChangeOpen", "nombre": "Cambiar a actitud cercana", "categoria": "dialogo", "busqueda": "Mood Change Open"},
      {"evento": "RF_MoodChangeGuarded", "nombre": "Cambiar a actitud distante", "categoria": "dialogo", "busqueda": "Mood Change Guarded"},
      {"evento": "RF_MoodChangePlayful", "nombre": "Cambiar a actitud juguetona", "categoria": "dialogo", "busqueda": "Mood Change Playful"},
      {"evento": "RF_MoodChangeSerious", "nombre": "Cambiar a actitud seria", "categoria": "dialogo", "busqueda": "Mood Change Serious"},
      {"evento": "RF_OpenDismissive_In", "nombre": "Cercana: desdén", "categoria": "dialogo", "busqueda": "Open Dismissive"},
      {"evento": "RF_OpenInterested_In", "nombre": "Cercana: interés", "categoria": "dialogo", "busqueda": "Open Interested"},
      {"evento": "RF_OpenThrowHands_In", "nombre": "Cercana: manos al aire", "categoria": "dialogo", "busqueda": "Open Throw Hands"},
      {"evento": "RF_Shock_Open", "nombre": "Cercana: sobresalto", "categoria": "dialogo", "busqueda": "Shock Open"},
      {"evento": "RF_OpenPleading_In", "nombre": "Cercana: súplica", "categoria": "dialogo", "busqueda": "Open Pleading"},
      {"evento": "RF_GuardedDismissive_In", "nombre": "Distante: desdén", "categoria": "dialogo", "busqueda": "Guarded Dismissive"},
      {"evento": "RF_GuardedInterested_In", "nombre": "Distante: interés", "categoria": "dialogo", "busqueda": "Guarded Interested"},
      {"evento": "RF_GuardedThrowHands_In", "nombre": "Distante: manos al aire", "categoria": "dialogo", "busqueda": "Guarded Throw Hands"},
      {"evento": "RF_Shock_Guarded", "nombre": "Distante: sobresalto", "categoria": "dialogo", "busqueda": "Shock Guarded"},
      {"evento": "RF_GuardedPleading_In", "nombre": "Distante: súplica", "categoria": "dialogo", "busqueda": "Guarded Pleading"},
      {"evento": "PairEnd", "nombre": "Fin de la escena en pareja", "categoria": "dialogo", "busqueda": "DLC1 Pair End"},
      {"evento": "IdleDialogueDefensiveHandGesture", "nombre": "Gesto a la defensiva", "categoria": "dialogo", "busqueda": "Dialogue Defensive Hand Gesture"},
      {"evento": "IdleDialogueWelcomeHandGesture", "nombre": "Gesto de bienvenida", "categoria": "dialogo", "busqueda": "Dialogue Welcome Hand Gesture"},
      {"evento": "IdleDialogueStart", "nombre": "Hablar", "categoria": "dialogo", "busqueda": "Talking"},
      {"evento": "IdleDialogueMovingTalkA", "nombre": "Hablar andando (A)", "categoria": "dialogo", "busqueda": "Dialogue Moving Talk A"},
      {"evento": "IdleDialogueMovingTalkB", "nombre": "Hablar andando (B)", "categoria": "dialogo", "busqueda": "Dialogue Moving Talk B"},
      {"evento": "IdleDialogueMovingTalkC", "nombre": "Hablar andando (C)", "categoria": "dialogo", "busqueda": "Dialogue Moving Talk C"},
      {"evento": "IdleDialogueMovingTalkD", "nombre": "Hablar andando (D)", "categoria": "dialogo", "busqueda": "Dialogue Moving Talk D"},
      {"evento": "DialogueNeutral", "nombre": "Hablar con naturalidad", "categoria": "dialogo", "busqueda": "Dialogue Neutral Expressive"},
      {"evento": "IdleDialogueAngryStart", "nombre": "Hablar enfadado", "categoria": "dialogo", "busqueda": "Talking Angry"},
      {"evento": "MotionDrivenDialogueAngry", "nombre": "Hablar enfadado mientras te mueves", "categoria": "dialogo", "busqueda": "Dialogue Angry Motion Driven"},
      {"evento": "IdleDialogueExpressiveStart", "nombre": "Hablar gesticulando", "categoria": "dialogo", "busqueda": "Talking Expressive"},
      {"evento": "MotionDrivenDialogueGeneric", "nombre": "Hablar mientras te mueves", "categoria": "dialogo", "busqueda": "Dialogue Generic Motion Driven"},
      {"evento": "MotionDrivenDialogueNextClip", "nombre": "Hablar: cambiar de gesto", "categoria": "dialogo", "busqueda": "Dialogue Neutral Shift Motion Driven"},
      {"evento": "RF_PlayfulDismissive_In", "nombre": "Juguetona: desdén", "categoria": "dialogo", "busqueda": "Playful Dismissive"},
      {"evento": "RF_PlayfulInterested_In", "nombre": "Juguetona: interés", "categoria": "dialogo", "busqueda": "Playful Interested"},
      {"evento": "RF_PlayfulThrowHands_In", "nombre": "Juguetona: manos al aire", "categoria": "dialogo", "busqueda": "Playful Throw Hands"},
      {"evento": "RF_Shock_Playful", "nombre": "Juguetona: sobresalto", "categoria": "dialogo", "busqueda": "Shock Playful"},
      {"evento": "RF_PlayfulPleading_In", "nombre": "Juguetona: súplica", "categoria": "dialogo", "busqueda": "Playful Pleading"},
      {"evento": "IdleDialogueHandOnChinGesture", "nombre": "Mano en la barbilla", "categoria": "dialogo", "busqueda": "Dialogue Hand On Chin Gesture"},
      {"evento": "RF_Talk_In", "nombre": "Ponerse a hablar", "categoria": "dialogo", "busqueda": "Talk"},
      {"evento": "LooseDialogueResponseNegative", "nombre": "Responder que no", "categoria": "dialogo", "busqueda": "Loose Dialogue Response Negative"},
      {"evento": "LooseDialogueResponsePositive", "nombre": "Responder que sí", "categoria": "dialogo", "busqueda": "Loose Dialogue Response Positive"},
      {"evento": "RF_SeriousDismissive_In", "nombre": "Seria: desdén", "categoria": "dialogo", "busqueda": "Serious Dismissive"},
      {"evento": "RF_SeriousInterested_In", "nombre": "Seria: interés", "categoria": "dialogo", "busqueda": "Serious Interested"},
      {"evento": "RF_SeriousThrowHands_In", "nombre": "Seria: manos al aire", "categoria": "dialogo", "busqueda": "Serious Throw Hands"},
      {"evento": "RF_Shock_Serious", "nombre": "Seria: sobresalto", "categoria": "dialogo", "busqueda": "Shock Serious"},
      {"evento": "RF_SeriousPleading_In", "nombre": "Seria: súplica", "categoria": "dialogo", "busqueda": "Serious Pleading"},
      {"evento": "RF_Idle_Out", "nombre": "Volver a la actitud normal", "categoria": "dialogo", "busqueda": "Romantic Follower Stop"},
      {"evento": "IdleActivateCoffinPuzzle", "nombre": "Accionar el cuenco del ataúd", "categoria": "dormir", "busqueda": "DLC1 Coffin Puzzle Bowl Idle"},
      {"evento": "IdleBedRightEnterStart", "nombre": "Acostarse por la derecha", "categoria": "dormir", "busqueda": "Right Bed Enter"},
      {"evento": "IdleBedRightEnterInstant", "nombre": "Acostarse por la derecha (al instante)", "categoria": "dormir", "busqueda": "Right Bed Enter Instant"},
      {"evento": "IdleBedLeftEnterStart", "nombre": "Acostarse por la izquierda", "categoria": "dormir", "busqueda": "Left Bed Enter", "destacada": true},
      {"evento": "IdleBedLeftEnterInstant", "nombre": "Acostarse por la izquierda (al instante)", "categoria": "dormir", "busqueda": "Left Bed Enter Instant"},
      {"evento": "IdleSleepNod", "nombre": "Dar cabezadas", "categoria": "dormir", "busqueda": "Sleep Nod"},
      {"evento": "IdleWebThrashShort", "nombre": "Forcejear en la telaraña", "categoria": "dormir", "busqueda": "Web Thrash Short"},
      {"evento": "IdleWebThrashShort2", "nombre": "Forcejear en la telaraña (2)", "categoria": "dormir", "busqueda": "Web Thrash Short2"},
      {"evento": "IdleBedExitStart", "nombre": "Levantarse de la cama", "categoria": "dormir", "busqueda": "Exit Bed"},
      {"evento": "Idle_1stPersonWoozyGetUpFromBed", "nombre": "Levantarse de la cama aturdido (1ª persona)", "categoria": "dormir", "busqueda": "1st Person Woozy Get Up From Bed"},
      {"evento": "IdleBedQuickExitStart", "nombre": "Levantarse de la cama, rápido", "categoria": "dormir", "busqueda": "Bed Quick Exit"},
      {"evento": "IdleCoffinEnter", "nombre": "Meterse en el ataúd", "categoria": "dormir", "busqueda": "Coffin Enter"},
      {"evento": "IdleCoffinEnterInstant", "nombre": "Meterse en el ataúd (al instante)", "categoria": "dormir", "busqueda": "Coffin Enter Instant Left"},
      {"evento": "IdleCoffinVertEnter", "nombre": "Meterse en el ataúd de pie", "categoria": "dormir", "busqueda": "DLC1 Idle Coffin Vert"},
      {"evento": "IdleCoffinVertEnterInstant", "nombre": "Meterse en el ataúd de pie (al instante)", "categoria": "dormir", "busqueda": "Dlc1 Idle Coffin Vert Enter Instant"},
      {"evento": "IdleCoffinHorzEnter", "nombre": "Meterse en el ataúd tumbado", "categoria": "dormir", "busqueda": "DLC1 Idle Coffin Horz Enter"},
      {"evento": "IdleCoffinHorzEnterInstant", "nombre": "Meterse en el ataúd tumbado (al instante)", "categoria": "dormir", "busqueda": "DLC1 Idle Coffin Horz Enter Instant"},
      {"evento": "IdleBedRollFrontEnterStart", "nombre": "Meterse en el petate de frente", "categoria": "dormir", "busqueda": "Front Bed Roll Enter"},
      {"evento": "IdleBedRollFrontEnterInstant", "nombre": "Meterse en el petate de frente (al instante)", "categoria": "dormir", "busqueda": "Front Bed Roll Enter Instant"},
      {"evento": "IdleBedRollRightEnterStart", "nombre": "Meterse en el petate por la derecha", "categoria": "dormir", "busqueda": "Right Bed Roll Enter"},
      {"evento": "IdleBedRollRightEnterInstant", "nombre": "Meterse en el petate por la derecha (al instante)", "categoria": "dormir", "busqueda": "Right Bed Roll Enter Instant"},
      {"evento": "IdleBedRollLeftEnterStart", "nombre": "Meterse en el petate por la izquierda", "categoria": "dormir", "busqueda": "Left Bed Roll Enter"},
      {"evento": "IdleBedRollLeftEnterInstant", "nombre": "Meterse en el petate por la izquierda (al instante)", "categoria": "dormir", "busqueda": "Left Bed Roll Enter Instant"},
      {"evento": "MS12BedDeath", "nombre": "Morir en la cama", "categoria": "dormir", "busqueda": "MS12 Bed Death"},
      {"evento": "IdleChildLayOnFloor", "nombre": "Niño: tumbarse en el suelo", "categoria": "dormir", "busqueda": "Child Lay On Floor Enter"},
      {"evento": "IdleChildLayOnFloorInstant", "nombre": "Niño: tumbarse en el suelo (al instante)", "categoria": "dormir", "busqueda": "Child Lay On Floor Enter Instant"},
      {"evento": "IdleWebEnterInstant", "nombre": "Quedar atrapado en la telaraña", "categoria": "dormir", "busqueda": "Enter Web Instant"},
      {"evento": "DLC01CoffinEnterInstant", "nombre": "Serana: meterse en el ataúd", "categoria": "dormir", "busqueda": "DLC1 Serana Coffin Enter Instant"},
      {"evento": "IdleWebExit", "nombre": "Soltarse de la telaraña", "categoria": "dormir", "busqueda": "Web Idle Exit"},
      {"evento": "IdleWebExitQuickTurn", "nombre": "Soltarse de la telaraña y girarse", "categoria": "dormir", "busqueda": "Web Idle Exit Quick Turn"},
      {"evento": "VampireFeedingBedRollRight", "nombre": "Vampiro: alimentarse en el petate, por la derecha", "categoria": "dormir", "busqueda": "Vampire Bedroll Right"},
      {"evento": "VampireFeedingBedRollLeft", "nombre": "Vampiro: alimentarse en el petate, por la izquierda", "categoria": "dormir", "busqueda": "Vampire Bedroll Left"},
      {"evento": "VampireFeedingBedRight", "nombre": "Vampiro: alimentarse en la cama, por la derecha", "categoria": "dormir", "busqueda": "Vampire Bed Right"},
      {"evento": "VampireFeedingBedLeft", "nombre": "Vampiro: alimentarse en la cama, por la izquierda", "categoria": "dormir", "busqueda": "Vampire Bed Left"},
      {"evento": "IdleMT_DoorBang", "nombre": "Aporrear una puerta", "categoria": "gestos", "busqueda": "MT Door Bang"},
      {"evento": "IdleKneelingEnter", "nombre": "Arrodillarse", "categoria": "gestos", "busqueda": "Kneeling Enter", "destacada": true},
      {"evento": "IdleKneelingEnterInstant", "nombre": "Arrodillarse (al instante)", "categoria": "gestos", "busqueda": "Kneeling Enter Instant"},
      {"evento": "IdleKneeling", "nombre": "Arrodillarse junto a un cadáver", "categoria": "gestos", "busqueda": "Check Corpse"},
      {"evento": "idle_A_sway_fastTrans", "nombre": "Balancearse", "categoria": "gestos", "busqueda": "A sway fast Trans"},
      {"evento": "idle_A_leg_shift", "nombre": "Cambiar el peso de pierna", "categoria": "gestos", "busqueda": "A leg shift"},
      {"evento": "idle_A_left_longTrans", "nombre": "Cargar el peso a la izquierda", "categoria": "gestos", "busqueda": "A left long Trans"},
      {"evento": "OffsetArmsCrossedStart", "nombre": "Cruzarse de brazos", "categoria": "gestos", "busqueda": "Offset Arms Crossed Start", "destacada": true},
      {"evento": "IdleCowering", "nombre": "Encogerse de miedo", "categoria": "gestos", "busqueda": "Cower", "destacada": true},
      {"evento": "IdleCowerEnterInstant", "nombre": "Encogerse de miedo (al instante)", "categoria": "gestos", "busqueda": "Cower Enter Instant"},
      {"evento": "IdleCowerEnter", "nombre": "Encogerse de miedo (empezar)", "categoria": "gestos", "busqueda": "Cower Enter"},
      {"evento": "idle_A_swat_flies", "nombre": "Espantar moscas", "categoria": "gestos", "busqueda": "A swat flies"},
      {"evento": "idle_A_shoulders", "nombre": "Estirar los hombros", "categoria": "gestos", "busqueda": "A shoulders"},
      {"evento": "idle_A_shouldersVar1", "nombre": "Estirar los hombros (2)", "categoria": "gestos", "busqueda": "A shoulders Var1"},
      {"evento": "IdleWalkingCameraEnd", "nombre": "Fin del paseo de cámara", "categoria": "gestos", "busqueda": "Walking Camera End"},
      {"evento": "idleFreaDisbeliefLoopStop", "nombre": "Frea: dejar la incredulidad", "categoria": "gestos", "busqueda": "DLC2 Frea Reaction Stop"},
      {"evento": "IdleFreaDisbelief2LoopStop", "nombre": "Frea: dejar la incredulidad (2)", "categoria": "gestos", "busqueda": "DLC2 Idle Frea Disbelief2 Stop"},
      {"evento": "idleFreaReactionStart", "nombre": "Frea: incredulidad", "categoria": "gestos", "busqueda": "DLC2 Frea Disbelief Start"},
      {"evento": "IdleFreaReaction2Start", "nombre": "Frea: incredulidad (2)", "categoria": "gestos", "busqueda": "DLC2 Idle Frea Disbelief2 Start"},
      {"evento": "idleFreaSorrowLoopEnter", "nombre": "Frea: pena", "categoria": "gestos", "busqueda": "DLC2 Frea Sorrow Enter"},
      {"evento": "IdleFreaSorrowLoopEnterInstant", "nombre": "Frea: pena (al instante)", "categoria": "gestos", "busqueda": "DLC2 Frea Sorrow Enter Instant"},
      {"evento": "idleFreaSorrowExit", "nombre": "Frea: salir de la pena", "categoria": "gestos", "busqueda": "DLC2 Frea Sorrow Exit"},
      {"evento": "IdleHDRight", "nombre": "Gesto hacia la derecha (variante HD)", "categoria": "gestos", "busqueda": "HD Right"},
      {"evento": "IdleHHRight", "nombre": "Gesto hacia la derecha (variante HH)", "categoria": "gestos", "busqueda": "HH Right"},
      {"evento": "IdleTalkAndUseItem", "nombre": "Hablar manejando algo", "categoria": "gestos", "busqueda": "Talking With Item"},
      {"evento": "IdleComeThisWay", "nombre": "Hacer señas para que te sigan", "categoria": "gestos", "busqueda": "Come This Way", "destacada": true},
      {"evento": "IdleGrave_01", "nombre": "Inclinar la cabeza ante una tumba", "categoria": "gestos", "busqueda": "Bow Head At Grave 01"},
      {"evento": "IdleGrave_02", "nombre": "Inclinar la cabeza ante una tumba (2)", "categoria": "gestos", "busqueda": "Bow Head At Grave 02"},
      {"evento": "IdleSilentBow", "nombre": "Inclinarse en silencio", "categoria": "gestos", "busqueda": "MQ Phantom Unsummon"},
      {"evento": "idleDisbelief01Start", "nombre": "Incredulidad", "categoria": "gestos", "busqueda": "DLC2 Storn Reaction1 Start"},
      {"evento": "idleDisbelief02Start", "nombre": "Incredulidad (2)", "categoria": "gestos", "busqueda": "DLC2 Storn Reaction2 Start"},
      {"evento": "idle_A_soft_rightTrans", "nombre": "Ladearse a la derecha", "categoria": "gestos", "busqueda": "A soft right trans"},
      {"evento": "IdleCleanSword", "nombre": "Limpiar la espada", "categoria": "gestos", "busqueda": "Clean Sword"},
      {"evento": "IdleGetAttention", "nombre": "Llamar la atención", "categoria": "gestos", "busqueda": "Get Attention"},
      {"evento": "IdleHandsBehindBack", "nombre": "Manos a la espalda", "categoria": "gestos", "busqueda": "Hands Behind Back", "destacada": true},
      {"evento": "IdlePresentSkeletonKey", "nombre": "Mostrar la Llave Maestra", "categoria": "gestos", "busqueda": "Present Skeleton Key"},
      {"evento": "IdleNervous", "nombre": "Nerviosismo", "categoria": "gestos", "busqueda": "Nervous", "destacada": true},
      {"evento": "IdleChildTaunt1", "nombre": "Niño: burlarse (1)", "categoria": "gestos", "busqueda": "Child Taunt1"},
      {"evento": "IdleChildTaunt2", "nombre": "Niño: burlarse (2)", "categoria": "gestos", "busqueda": "Child Taunt2"},
      {"evento": "IdleChildTaunt3", "nombre": "Niño: burlarse (3)", "categoria": "gestos", "busqueda": "Child Taunt3"},
      {"evento": "IdleChildTaunt4", "nombre": "Niño: burlarse (4)", "categoria": "gestos", "busqueda": "Child Taunt4"},
      {"evento": "IdleChildCryingEnd", "nombre": "Niño: dejar de llorar", "categoria": "gestos", "busqueda": "Child Crying End"},
      {"evento": "IdleChildPlayDirt", "nombre": "Niño: jugar con la tierra", "categoria": "gestos", "busqueda": "Child Play Dirt"},
      {"evento": "IdleChildPlayDoll", "nombre": "Niño: jugar con una muñeca", "categoria": "gestos", "busqueda": "Child Play Doll"},
      {"evento": "IdleChildCryingStart", "nombre": "Niño: llorar", "categoria": "gestos", "busqueda": "Child Crying Start"},
      {"evento": "IdleChildFidget", "nombre": "Niño: moverse inquieto", "categoria": "gestos", "busqueda": "Child Fidget"},
      {"evento": "IdleChildApologize", "nombre": "Niño: pedir perdón", "categoria": "gestos", "busqueda": "Child Apologize"},
      {"evento": "IdleChildWhineKick", "nombre": "Niño: rabieta a patadas", "categoria": "gestos", "busqueda": "Child Whine Kick"},
      {"evento": "IdleChildWhineStompFeet", "nombre": "Niño: rabieta pataleando", "categoria": "gestos", "busqueda": "Child Whine Stomp"},
      {"evento": "IdleChildLegsOutStart", "nombre": "Niño: sentarse con las piernas estiradas", "categoria": "gestos", "busqueda": "Child Legs Out"},
      {"evento": "IdleChildSitOnKnees", "nombre": "Niño: sentarse de rodillas", "categoria": "gestos", "busqueda": "Child Sit On Knees Enter"},
      {"evento": "IdleChildSitOnKneesInstant", "nombre": "Niño: sentarse de rodillas (al instante)", "categoria": "gestos", "busqueda": "Child Sit On Knees Enter Instant"},
      {"evento": "IdleChildShy", "nombre": "Niño: timidez", "categoria": "gestos", "busqueda": "Child Shy"},
      {"evento": "IdleLookFar", "nombre": "Otear el horizonte", "categoria": "gestos", "busqueda": "Look Far"},
      {"evento": "IdleWalkingCameraStart", "nombre": "Paseo de cámara", "categoria": "gestos", "busqueda": "Walking Camera Start"},
      {"evento": "IdleSnapToAttention", "nombre": "Ponerse firme", "categoria": "gestos", "busqueda": "Snap To Attention", "destacada": true},
      {"evento": "IdleAstridEnter", "nombre": "Pose de Astrid", "categoria": "gestos", "busqueda": "Astrid"},
      {"evento": "IdleStaticPoseAStart", "nombre": "Pose fija A", "categoria": "gestos", "busqueda": "Static Pose A"},
      {"evento": "IdleStaticPoseBStart", "nombre": "Pose fija B", "categoria": "gestos", "busqueda": "Static Pose B"},
      {"evento": "IdleStaticPoseCStart", "nombre": "Pose fija C", "categoria": "gestos", "busqueda": "Static Pose C"},
      {"evento": "IdlePlayer", "nombre": "Postura del jugador", "categoria": "gestos", "busqueda": "Player Stop"},
      {"evento": "idle_A_scratch_back", "nombre": "Rascarse la espalda", "categoria": "gestos", "busqueda": "A scratch back"},
      {"evento": "IdleSurrender", "nombre": "Rendirse", "categoria": "gestos", "busqueda": "Surrender", "destacada": true},
      {"evento": "IdleLaugh", "nombre": "Reírse", "categoria": "gestos", "busqueda": "Laugh", "destacada": true},
      {"evento": "idle_A_shakeout", "nombre": "Sacudirse", "categoria": "gestos", "busqueda": "A shakeout"},
      {"evento": "idleDisbelief01Exit", "nombre": "Salir de la incredulidad", "categoria": "gestos", "busqueda": "DLC2 Storn Reaction1 Stop"},
      {"evento": "idleDisbelief02Exit", "nombre": "Salir de la incredulidad (2)", "categoria": "gestos", "busqueda": "DLC2 Storn Reaction2 Stop"},
      {"evento": "IdleWave", "nombre": "Saludar con la mano", "categoria": "gestos", "busqueda": "Wave", "destacada": true},
      {"evento": "IdleSalute", "nombre": "Saludo militar", "categoria": "gestos", "busqueda": "Salute", "destacada": true},
      {"evento": "IdleWipeBrow", "nombre": "Secarse la frente", "categoria": "gestos", "busqueda": "Wipe Brow"},
      {"evento": "IdlePointFar_01", "nombre": "Señalar a lo lejos", "categoria": "gestos", "busqueda": "Point Far 01", "destacada": true},
      {"evento": "IdlePointFar_02", "nombre": "Señalar a lo lejos (2)", "categoria": "gestos", "busqueda": "Point Far 02"},
      {"evento": "IdlePointClose", "nombre": "Señalar algo cerca", "categoria": "gestos", "busqueda": "Point Close"},
      {"evento": "idle_A_pull_pants", "nombre": "Subirse los pantalones", "categoria": "gestos", "busqueda": "A pull pants"},
      {"evento": "idle_A_sigh_var1Trans", "nombre": "Suspirar", "categoria": "gestos", "busqueda": "A sigh var1 Trans"},
      {"evento": "idle_A_sigh_var2Trans", "nombre": "Suspirar (2)", "categoria": "gestos", "busqueda": "A sigh var2 Trans"},
      {"evento": "IdleValericaWalkForward", "nombre": "Valerica: caminar hacia delante", "categoria": "gestos", "busqueda": "Valerica Walk Forward"},
      {"evento": "IdleBracedPain", "nombre": "Aguantar el dolor", "categoria": "herido", "busqueda": "Braced Pain"},
      {"evento": "IdlePrisonerBeat", "nombre": "Apalear a un preso", "categoria": "herido", "busqueda": "Prisoner Beat"},
      {"evento": "TG05_StabPlayer", "nombre": "Apuñalar al jugador", "categoria": "herido", "busqueda": "TG05 Stab Player"},
      {"evento": "IdleCartExitInstant", "nombre": "Bajarse del carro (al instante)", "categoria": "herido", "busqueda": "Cart Exit Instant"},
      {"evento": "IdleDLC02FallOnKnees", "nombre": "Caer de rodillas", "categoria": "herido", "busqueda": "DLC02 Fall On Knees"},
      {"evento": "BoundStandingCut", "nombre": "Cortar las ataduras", "categoria": "herido", "busqueda": "Bound Standing Cut"},
      {"evento": "BoundStandingCutNPC", "nombre": "Cortarle las ataduras a alguien", "categoria": "herido", "busqueda": "Bound Standing Cut NPC"},
      {"evento": "IdleHandCut", "nombre": "Cortarse la mano", "categoria": "herido", "busqueda": "Hand Cut"},
      {"evento": "IdleBoundKneesEnterInstant", "nombre": "De rodillas y maniatado", "categoria": "herido", "busqueda": "Bound Knees Enter Instant"},
      {"evento": "IdleExecutionGuardIdle", "nombre": "Guardia de la ejecución", "categoria": "herido", "busqueda": "Executioner Guard Enter"},
      {"evento": "IdleExecutionGuardIdleEnterInstant", "nombre": "Guardia de la ejecución (al instante)", "categoria": "herido", "busqueda": "Esxecutioner Guard Enter Instant"},
      {"evento": "IdleInjured", "nombre": "Herido", "categoria": "herido", "busqueda": "Injured", "destacada": true},
      {"evento": "IdleWounded_01", "nombre": "Herido (1)", "categoria": "herido", "busqueda": "Wounded 01", "destacada": true},
      {"evento": "IdleWounded_02", "nombre": "Herido (2)", "categoria": "herido", "busqueda": "Wounded 02"},
      {"evento": "IdleWounded_03", "nombre": "Herido (3)", "categoria": "herido", "busqueda": "Wounded 03"},
      {"evento": "TG05_GetUp", "nombre": "Levantarse aturdido", "categoria": "herido", "busqueda": "TG05 Get Up"},
      {"evento": "GetUpBegin", "nombre": "Levantarse del suelo", "categoria": "herido", "busqueda": "NPC Get Up"},
      {"evento": "OffsetBoundStandingStart", "nombre": "Maniatado de pie", "categoria": "herido", "busqueda": "Offset Bound Standing Start"},
      {"evento": "OffsetBoundStandingPlayerInstant", "nombre": "Maniatado de pie (al instante)", "categoria": "herido", "busqueda": "Offset Bound Standing Player Instant"},
      {"evento": "IdleDLC02MiraakDeathFinish", "nombre": "Miraak: fin de su muerte", "categoria": "herido", "busqueda": "DLC02 Miraak Death Finish"},
      {"evento": "IdleDLC02MiraakDeath", "nombre": "Miraak: morir", "categoria": "herido", "busqueda": "DLC02 Miraak Death Start"},
      {"evento": "DeathAnim", "nombre": "Morir", "categoria": "herido", "busqueda": "Death Animation Start"},
      {"evento": "IdleSoupDeath", "nombre": "Morir sobre el plato", "categoria": "herido", "busqueda": "Soup Death"},
      {"evento": "IdleCartPrisonerAExit", "nombre": "Preso A: bajarse del carro", "categoria": "herido", "busqueda": "Cart Prisoner A Exit"},
      {"evento": "IdleCartPrisonerAIdle", "nombre": "Preso A: en el carro", "categoria": "herido", "busqueda": "Cart Prisoner A Idle"},
      {"evento": "IdleCartPrisonerASway", "nombre": "Preso A: vaivén del carro", "categoria": "herido", "busqueda": "Cart Prisoner A Sway"},
      {"evento": "IdleCartPrisonerBExit", "nombre": "Preso B: bajarse del carro", "categoria": "herido", "busqueda": "Cart Prisoner B Exit"},
      {"evento": "IdleCartPrisonerBIdle", "nombre": "Preso B: en el carro", "categoria": "herido", "busqueda": "Cart Prisoner B Idle"},
      {"evento": "IdleCartPrisonerBSway", "nombre": "Preso B: vaivén del carro", "categoria": "herido", "busqueda": "Cart Prisoner B Sway"},
      {"evento": "IdleCartPrisonerCExit", "nombre": "Preso C: bajarse del carro", "categoria": "herido", "busqueda": "Cart Prisoner C Exit"},
      {"evento": "IdleCartPrisonerCIdle", "nombre": "Preso C: en el carro", "categoria": "herido", "busqueda": "Cart Prisoner C Idle"},
      {"evento": "IdleCartPrisonerCSway", "nombre": "Preso C: vaivén del carro", "categoria": "herido", "busqueda": "Cart Prisoner C Sway"},
      {"evento": "IdleCartPrisonerDExit", "nombre": "Preso D: bajarse del carro", "categoria": "herido", "busqueda": "Cart Prisoner D Exit"},
      {"evento": "IdleCartPrisonerDIdle", "nombre": "Preso D: en el carro", "categoria": "herido", "busqueda": "Cart Prisoner D Idle"},
      {"evento": "IdleCartPrisonerDSway", "nombre": "Preso D: vaivén del carro", "categoria": "herido", "busqueda": "Cart Prisoner D Sway"},
      {"evento": "TG05_KnockOut", "nombre": "Quedar inconsciente", "categoria": "herido", "busqueda": "TG05 Knock Out"},
      {"evento": "IdleExecutionerAlduinReaction", "nombre": "Reacción ante Alduin", "categoria": "herido", "busqueda": "Executioner Alduin Reaction"},
      {"evento": "IdleExecutionerAlduinReactionDeath", "nombre": "Reacción ante Alduin: morir", "categoria": "herido", "busqueda": "Executioner Alduin Reaction Death"},
      {"evento": "IdleFurnitureExitTriggered", "nombre": "Salir del mueble (forzado)", "categoria": "herido", "busqueda": "Executioner Guard Exit"},
      {"evento": "IdleUncontrollableCough", "nombre": "Tos incontrolable", "categoria": "herido", "busqueda": "Uncontrollable Cough"},
      {"evento": "IdleExecutionerChop", "nombre": "Verdugo: decapitar", "categoria": "herido", "busqueda": "Head Chop"},
      {"evento": "IdleExecutionerChop_Player", "nombre": "Verdugo: decapitar al jugador", "categoria": "herido", "busqueda": "Executioner Chop Player"},
      {"evento": "IdleMQ203EsbernBookEnter", "nombre": "Esbern: consultar un libro", "categoria": "leer", "busqueda": "MQ203 Esbern Book Enter"},
      {"evento": "IdleMQ203EsbernBookEnterInstant", "nombre": "Esbern: consultar un libro (al instante)", "categoria": "leer", "busqueda": "MQ203 Esbern Book Enter Instant"},
      {"evento": "IdleStudy", "nombre": "Estudiar", "categoria": "leer", "busqueda": "Study", "destacada": true},
      {"evento": "IdleBook_Read", "nombre": "Leer un libro", "categoria": "leer", "busqueda": "Book Reading", "destacada": true},
      {"evento": "IdleBook_ReadTG06", "nombre": "Leer un libro (traducción)", "categoria": "leer", "busqueda": "Book Read TG06"},
      {"evento": "IdleNoteRead", "nombre": "Leer una nota", "categoria": "leer", "busqueda": "Note Read", "destacada": true},
      {"evento": "IdleTG06FlipPage", "nombre": "Pasar la página", "categoria": "leer", "busqueda": "TG06 Flip Page"},
      {"evento": "IdleBook_PageTurn", "nombre": "Pasar páginas", "categoria": "leer", "busqueda": "Book Turn Many Pages"},
      {"evento": "IdleBook_OnePage", "nombre": "Pasar una página", "categoria": "leer", "busqueda": "Book Turn One Page"},
      {"evento": "IdleRFPickUpScroll", "nombre": "Recoger un pergamino", "categoria": "leer", "busqueda": "RF Pick Up Scroll"},
      {"evento": "IdleTG06TranslationEnter", "nombre": "Traducir un texto", "categoria": "leer", "busqueda": "TG06 Translate Enter"},
      {"evento": "IdleTG06TranslationEnterInstant", "nombre": "Traducir un texto (al instante)", "categoria": "leer", "busqueda": "TG06 Translate Enter Instant"},
      {"evento": "IdleDLC2TentacleWarpBook", "nombre": "Abrir el libro que te transporta", "categoria": "magia", "busqueda": "DLC2 Tentacle Warp Book"},
      {"evento": "IdleBloodPortalActivate", "nombre": "Activar el portal de sangre", "categoria": "magia", "busqueda": "Blood Portal Activate"},
      {"evento": "IdleBlessingKneelEnter", "nombre": "Arrodillarse a recibir la bendición", "categoria": "magia", "busqueda": "Blessing Kneel Enter", "destacada": true},
      {"evento": "IdleBlessingKneelEnterInstant", "nombre": "Arrodillarse a recibir la bendición (al instante)", "categoria": "magia", "busqueda": "Blessing Kneel Enter Instant"},
      {"evento": "IdleT02AscendMale", "nombre": "Ascender (hombre)", "categoria": "magia", "busqueda": "T02 Ascend Male"},
      {"evento": "IdleT02AscendFemale", "nombre": "Ascender (mujer)", "categoria": "magia", "busqueda": "T02 Ascend Female"},
      {"evento": "IdleTelvanniTowerFloatUp", "nombre": "Ascender flotando (torre Telvanni)", "categoria": "magia", "busqueda": "Telvanni Tower Float Up Enter"},
      {"evento": "IdleDA02BoethiahPostEnter", "nombre": "Atado al poste de Boethiah", "categoria": "magia", "busqueda": "DA02 Boethiah Post Enter"},
      {"evento": "IdleDA02BoethiahPostEnterInstant", "nombre": "Atado al poste de Boethiah (al instante)", "categoria": "magia", "busqueda": "DA02 Boethiah Post Enter Instant"},
      {"evento": "IdleWalkThroughWallEnter", "nombre": "Atravesar la pared", "categoria": "magia", "busqueda": "Walk Through Wall Enter"},
      {"evento": "IdleWalkThroughWallEnterInstant", "nombre": "Atravesar la pared (al instante)", "categoria": "magia", "busqueda": "Walk Through Wall Enter Instant"},
      {"evento": "IdleGreybeardWordTeach", "nombre": "Barbas Grises: enseñar una Palabra", "categoria": "magia", "busqueda": "Greybeard Word Teach"},
      {"evento": "IdleGreybeardMeditateEnter", "nombre": "Barbas Grises: meditar", "categoria": "magia", "busqueda": "Greybeard Meditate Enter"},
      {"evento": "IdleGreybeardMeditateEnterInstant", "nombre": "Barbas Grises: meditar (al instante)", "categoria": "magia", "busqueda": "Greybeard Meditate Enter Instant"},
      {"evento": "IdleCannibalFeedStanding", "nombre": "Caníbal: devorar de pie", "categoria": "magia", "busqueda": "Cannibal Feed Standing"},
      {"evento": "IdleCannibalFeedCrouching", "nombre": "Caníbal: devorar en cuclillas", "categoria": "magia", "busqueda": "Cannibal Feed Crouching"},
      {"evento": "IdleCO2Ceremony3Chest", "nombre": "Ceremonia: abrir el cofre", "categoria": "magia", "busqueda": "CO2 Ceremony3 Chest"},
      {"evento": "IdleCO2Ceremony2Blessing", "nombre": "Ceremonia: bendecir", "categoria": "magia", "busqueda": "CO2 Ceremony2 Blessing"},
      {"evento": "IdleCO2Ceremony1Welcome", "nombre": "Ceremonia: dar la bienvenida", "categoria": "magia", "busqueda": "CO2 Ceremony1 Welcome"},
      {"evento": "IdleMesmerizeStop", "nombre": "Dejar de hipnotizar", "categoria": "magia", "busqueda": "Mesmerize Stop"},
      {"evento": "IdleTelvanniTowerFloatDown", "nombre": "Descender flotando (torre Telvanni)", "categoria": "magia", "busqueda": "Telvanni Tower Float Down Enter"},
      {"evento": "IdleRitualStart", "nombre": "Empezar un ritual", "categoria": "magia", "busqueda": "Ritual Start"},
      {"evento": "IdleDLC1BossExplosion1stP", "nombre": "Explosión (1ª persona)", "categoria": "magia", "busqueda": "DLC1 Boss Explosion1st P"},
      {"evento": "IdleMQ206FelldirShowScroll", "nombre": "Felldir: mostrar el pergamino", "categoria": "magia", "busqueda": "MQ206 Felldir Show Scroll"},
      {"evento": "IdleMQ206FelldirRitualEnter", "nombre": "Felldir: ritual", "categoria": "magia", "busqueda": "MQ206 Felldir Ritual Enter"},
      {"evento": "IdleMQ206FelldirRitualEnterInstant", "nombre": "Felldir: ritual (al instante)", "categoria": "magia", "busqueda": "MQ206 Felldir Ritual Enter Instant"},
      {"evento": "IdleMagic_01", "nombre": "Gesto de magia", "categoria": "magia", "busqueda": "Magic 01"},
      {"evento": "IdleDLC02TentacleWordBurnBegin", "nombre": "Grabar la Palabra (empezar)", "categoria": "magia", "busqueda": "DLC02 Tentacle Word Burn Begin"},
      {"evento": "IdleDLC02TentacleWordBurnEnd", "nombre": "Grabar la Palabra (terminar)", "categoria": "magia", "busqueda": "DLC02 Tentacle Word Burn End"},
      {"evento": "IdleMesmerize", "nombre": "Hipnotizar", "categoria": "magia", "busqueda": "Mesmerize"},
      {"evento": "IdleReadElderScroll", "nombre": "Leer el Pergamino Ancestral", "categoria": "magia", "busqueda": "Read Elder Scroll"},
      {"evento": "IdleReadElderScroll3rdP", "nombre": "Leer el Pergamino Ancestral (3ª persona)", "categoria": "magia", "busqueda": "DLC1 Read Elder Scroll3rd P Enter"},
      {"evento": "IdleReadElderScrollLonger", "nombre": "Leer el Pergamino Ancestral (largo)", "categoria": "magia", "busqueda": "Read Elder Scroll Longer"},
      {"evento": "IdleBoyRitual", "nombre": "Niño: ritual", "categoria": "magia", "busqueda": "Boy Ritual"},
      {"evento": "IdleNocturnal_Rise", "nombre": "Nocturnal: alzarse", "categoria": "magia", "busqueda": "Nocturnal Rise"},
      {"evento": "IdleNocturnalEnter", "nombre": "Nocturnal: aparecer", "categoria": "magia", "busqueda": "Nocturnal Enter DUPLICATE000"},
      {"evento": "IdleNocturnal_Exit", "nombre": "Nocturnal: desaparecer", "categoria": "magia", "busqueda": "Nocturnal Exit"},
      {"evento": "IdleNocturnal_LookRight", "nombre": "Nocturnal: mirar a la derecha", "categoria": "magia", "busqueda": "Nocturnal Look Right"},
      {"evento": "IdleNocturnal_LookLeft", "nombre": "Nocturnal: mirar a la izquierda", "categoria": "magia", "busqueda": "Nocturnal Look Left"},
      {"evento": "IdleNocturnal_IdleA", "nombre": "Nocturnal: pose A", "categoria": "magia", "busqueda": "Nocturnal Idle A"},
      {"evento": "IdleNocturnal_IdleAMirror", "nombre": "Nocturnal: pose A (reflejada)", "categoria": "magia", "busqueda": "Nocturnal Idle A Mirror"},
      {"evento": "IdleNocturnal_IdleB", "nombre": "Nocturnal: pose B", "categoria": "magia", "busqueda": "Nocturnal Idle B"},
      {"evento": "IdleSnowElfPrinceAscensionBurning", "nombre": "Príncipe elfo: ascensión en llamas", "categoria": "magia", "busqueda": "Snow Elf Prince Ascension"},
      {"evento": "IdleSnowElfPrinceBigSpell", "nombre": "Príncipe elfo: gran hechizo", "categoria": "magia", "busqueda": "Snow Elf Prince Big Spell"},
      {"evento": "IdleSnowElfPrinceBigSpellRelease", "nombre": "Príncipe elfo: soltar el gran hechizo", "categoria": "magia", "busqueda": "Snow Elf Prince Big Spell Release"},
      {"evento": "IdlePray", "nombre": "Rezar", "categoria": "magia", "busqueda": "Pray", "destacada": true},
      {"evento": "IdlePrayCrouchedEnter", "nombre": "Rezar en cuclillas", "categoria": "magia", "busqueda": "Crouched Pray Enter"},
      {"evento": "IdlePrayCrouchedEnterInstant", "nombre": "Rezar en cuclillas (al instante)", "categoria": "magia", "busqueda": "Crouched Pray Enter Instant"},
      {"evento": "IdleRitualSkull1", "nombre": "Ritual con la calavera (1)", "categoria": "magia", "busqueda": "Ritual Skull1"},
      {"evento": "IdleRitualSkull2", "nombre": "Ritual con la calavera (2)", "categoria": "magia", "busqueda": "Ritual Skull2"},
      {"evento": "IdleRitualSkull3", "nombre": "Ritual con la calavera (3)", "categoria": "magia", "busqueda": "Ritual Skull3"},
      {"evento": "IdleReadElderScrollEnd", "nombre": "Terminar de leer el Pergamino Ancestral", "categoria": "magia", "busqueda": "DLC1 Read Elder Scroll3rd P Exit"},
      {"evento": "IdleWerewolfTransformation", "nombre": "Transformarse en hombre lobo", "categoria": "magia", "busqueda": "Werewolf Transformation"},
      {"evento": "IdleVampireLordTransformation", "nombre": "Transformarse en Señor Vampiro", "categoria": "magia", "busqueda": "Vampire Lord Transformation"},
      {"evento": "IdleVampireFeastVictim", "nombre": "Víctima del banquete vampírico", "categoria": "magia", "busqueda": "Vampire Feast Victim Enter"},
      {"evento": "IdleApplaud2", "nombre": "Aplaudir", "categoria": "musica", "busqueda": "Applaud2", "destacada": true},
      {"evento": "IdleApplaud3", "nombre": "Aplaudir (2)", "categoria": "musica", "busqueda": "Applaud3"},
      {"evento": "IdleApplaud4", "nombre": "Aplaudir (3)", "categoria": "musica", "busqueda": "Applaud4"},
      {"evento": "IdleApplaud5", "nombre": "Aplaudir (4)", "categoria": "musica", "busqueda": "Applaud5"},
      {"evento": "IdleApplaudSarcastic", "nombre": "Aplaudir con sorna", "categoria": "musica", "busqueda": "Applaud Sarcastic"},
      {"evento": "IdleCiceroAgitated", "nombre": "Cicerón: alterado", "categoria": "musica", "busqueda": "Cicero Agitated"},
      {"evento": "IdleCiceroDance1", "nombre": "Cicerón: baile (1)", "categoria": "musica", "busqueda": "Cicero Dance1", "destacada": true},
      {"evento": "IdleCiceroDance2", "nombre": "Cicerón: baile (2)", "categoria": "musica", "busqueda": "Cicero Dance2"},
      {"evento": "IdleCiceroDance3", "nombre": "Cicerón: baile (3)", "categoria": "musica", "busqueda": "Cicero Dance3"},
      {"evento": "IdleCiceroHappy", "nombre": "Cicerón: contento", "categoria": "musica", "busqueda": "Cicero Happy"},
      {"evento": "SpectatorClap", "nombre": "Público: aplaudir", "categoria": "musica", "busqueda": "Spectator Clap"},
      {"evento": "SpectatorTalking", "nombre": "Público: cuchichear", "categoria": "musica", "busqueda": "Spectator Talk Fail Safe"},
      {"evento": "SpectatorGawk", "nombre": "Público: quedarse boquiabierto", "categoria": "musica", "busqueda": "Spectator Gawk"},
      {"evento": "SpectatorCheer", "nombre": "Público: vitorear", "categoria": "musica", "busqueda": "Spectator Cheer"},
      {"evento": "IdleBlowHornStormcloak", "nombre": "Tocar el cuerno de los Capas de la Tormenta", "categoria": "musica", "busqueda": "Blow Horn Stormcloak"},
      {"evento": "IdleBlowHornImperial", "nombre": "Tocar el cuerno imperial", "categoria": "musica", "busqueda": "Blow Horn Imperial"},
      {"evento": "IdleLuteStart", "nombre": "Tocar el laúd", "categoria": "musica", "busqueda": "Lute Start", "destacada": true},
      {"evento": "IdleDrumStart", "nombre": "Tocar el tambor", "categoria": "musica", "busqueda": "Drum Start", "destacada": true},
      {"evento": "IdleFluteStart", "nombre": "Tocar la flauta", "categoria": "musica", "busqueda": "Flute Start", "destacada": true},
      {"evento": "IdleCivilWarCheer", "nombre": "Vitorear", "categoria": "musica", "busqueda": "Civil War Cheer"},
      {"evento": "IdleSharpeningWheelStart", "nombre": "Afilar en la muela", "categoria": "oficios", "busqueda": "Sharpening Wheel Start"},
      {"evento": "IdleSharpeningWheelEnterInstant", "nombre": "Afilar en la muela (al instante)", "categoria": "oficios", "busqueda": "Sharpening Wheel Enter Instant"},
      {"evento": "IdleCartDriverExit", "nombre": "Bajarse del pescante", "categoria": "oficios", "busqueda": "Cart Driver Exit"},
      {"evento": "idleLooseSweepingStart", "nombre": "Barrer", "categoria": "oficios", "busqueda": "Loose Sweeping Start", "destacada": true},
      {"evento": "IdleHoe", "nombre": "Cavar con la azada", "categoria": "oficios", "busqueda": "Hoe", "destacada": true},
      {"evento": "IdleChiselStandingEnter", "nombre": "Cincelar de pie", "categoria": "oficios", "busqueda": "Chisel Standing Enter"},
      {"evento": "IdleChiselStandingEnterInstant", "nombre": "Cincelar de pie (al instante)", "categoria": "oficios", "busqueda": "Chisel Standing Enter Instant"},
      {"evento": "IdleChiselKneelingEnter", "nombre": "Cincelar de rodillas", "categoria": "oficios", "busqueda": "Chisel Kneeling Enter"},
      {"evento": "IdleChiselKneelingEnterInstant", "nombre": "Cincelar de rodillas (al instante)", "categoria": "oficios", "busqueda": "Chisel Kneeling Enter Instant"},
      {"evento": "IdleTake", "nombre": "Coger algo", "categoria": "oficios", "busqueda": "Take"},
      {"evento": "IdleWoodChopStart", "nombre": "Cortar leña", "categoria": "oficios", "busqueda": "Wood Chop Start", "destacada": true},
      {"evento": "IdleWoodChopEnterInstant", "nombre": "Cortar leña (al instante)", "categoria": "oficios", "busqueda": "Wood Chop Enter Instant"},
      {"evento": "IdleFeedChicken", "nombre": "Dar de comer a las gallinas", "categoria": "oficios", "busqueda": "Feed Chickens"},
      {"evento": "IdlewoodputdownEnter", "nombre": "Dejar la leña", "categoria": "oficios", "busqueda": "woodputdown Enter"},
      {"evento": "IdleStonePutDownEnter", "nombre": "Dejar una piedra", "categoria": "oficios", "busqueda": "Stone Put Down Enter"},
      {"evento": "IdleLightSconce", "nombre": "Encender una antorcha de pared", "categoria": "oficios", "busqueda": "Light Sconce"},
      {"evento": "IdleGive", "nombre": "Entregar algo", "categoria": "oficios", "busqueda": "Give"},
      {"evento": "IdleGiveMQ105Horn", "nombre": "Entregar el cuerno", "categoria": "oficios", "busqueda": "Give MQ105 Horn"},
      {"evento": "IdleWriteTableStandingEnter", "nombre": "Escribir de pie en la mesa", "categoria": "oficios", "busqueda": "Write Table Standing Enter"},
      {"evento": "IdleWriteTableStandingEnterInstant", "nombre": "Escribir de pie en la mesa (al instante)", "categoria": "oficios", "busqueda": "Write Table Standing Enter Instant"},
      {"evento": "IdleWriteLedgerEnter", "nombre": "Escribir en el registro", "categoria": "oficios", "busqueda": "Write Ledger Enter"},
      {"evento": "IdleWriteLedgerWrite", "nombre": "Escribir en el registro (escribiendo)", "categoria": "oficios", "busqueda": "Write Ledger Write"},
      {"evento": "IdleExamine", "nombre": "Examinar algo", "categoria": "oficios", "busqueda": "Examine"},
      {"evento": "IdleLockPick", "nombre": "Forzar una cerradura", "categoria": "oficios", "busqueda": "Lock Pick"},
      {"evento": "IdleCartDriverIdle", "nombre": "Llevar el carro", "categoria": "oficios", "busqueda": "Cart Driver Idle"},
      {"evento": "IdleCartDriverSway", "nombre": "Llevar el carro, con vaivén", "categoria": "oficios", "busqueda": "Cart Driver Sway"},
      {"evento": "OffsetFlowerBasketStart", "nombre": "Llevar el cesto de flores", "categoria": "oficios", "busqueda": "Offset Flower Basket Start"},
      {"evento": "OffsetCarryBasketStart", "nombre": "Llevar un cesto", "categoria": "oficios", "busqueda": "Offset Carry Basket Start"},
      {"evento": "OffsetCarryPotStart", "nombre": "Llevar un puchero", "categoria": "oficios", "busqueda": "Offset Carry Pot Start"},
      {"evento": "IdleDwemerExtractorEnter", "nombre": "Manejar el extractor dwemer", "categoria": "oficios", "busqueda": "Dwemer Extractor"},
      {"evento": "IdlePickaxeEnter", "nombre": "Picar con el pico", "categoria": "oficios", "busqueda": "Pickaxe Enter", "destacada": true},
      {"evento": "IdlePickaxeEnterInstant", "nombre": "Picar con el pico (al instante)", "categoria": "oficios", "busqueda": "Pickaxe Enter Instant"},
      {"evento": "IdleWriteLedgerChargenEnter", "nombre": "Ponerse a escribir en el registro", "categoria": "oficios", "busqueda": "Hadvar Write Ledger Enter"},
      {"evento": "IdleWriteLedgerEnterInstant", "nombre": "Ponerse a escribir en el registro (al instante)", "categoria": "oficios", "busqueda": "Hadvar Write Ledger Enter Instant"},
      {"evento": "IdleSearchingChest", "nombre": "Rebuscando en el cofre", "categoria": "oficios", "busqueda": "Searching Chest"},
      {"evento": "IdleSearchingTable", "nombre": "Rebuscando en la mesa", "categoria": "oficios", "busqueda": "Searching Table"},
      {"evento": "IdleSearchTableEnter", "nombre": "Rebuscar en la mesa", "categoria": "oficios", "busqueda": "Search Table Enter"},
      {"evento": "IdleSearchTableEnterInstant", "nombre": "Rebuscar en la mesa (al instante)", "categoria": "oficios", "busqueda": "Search Table Enter Instant"},
      {"evento": "IdleSearchChestEnter", "nombre": "Rebuscar en un cofre", "categoria": "oficios", "busqueda": "Search Chest Enter"},
      {"evento": "IdleSearchChestEnterInstant", "nombre": "Rebuscar en un cofre (al instante)", "categoria": "oficios", "busqueda": "Search Chest Enter Instant"},
      {"evento": "IdleWayShrineWaterScoopEnter", "nombre": "Recoger agua del santuario", "categoria": "oficios", "busqueda": "Way Shrine Water Scoop"},
      {"evento": "IdleActivatePickUp", "nombre": "Recoger algo", "categoria": "oficios", "busqueda": "Activate Pick Up"},
      {"evento": "IdlePickup_Ground", "nombre": "Recoger algo del suelo", "categoria": "oficios", "busqueda": "Pickup Ground"},
      {"evento": "OffsetCarryFlowerBasketPickStart", "nombre": "Recoger flores en el cesto", "categoria": "oficios", "busqueda": "Offset Carry Flower Basket Pick Start"},
      {"evento": "IdleWoodPickUpEnter", "nombre": "Recoger leña", "categoria": "oficios", "busqueda": "Wood Pick Up Enter"},
      {"evento": "IdleStonePickUpEnter", "nombre": "Recoger una piedra", "categoria": "oficios", "busqueda": "Stone Pick Up Exit"},
      {"evento": "IdleStonePickUpEnterInstant", "nombre": "Recoger una piedra (al instante)", "categoria": "oficios", "busqueda": "Stone Pick Up Enter Instant"},
      {"evento": "IdleOffsetCarryPotServe", "nombre": "Servir del puchero", "categoria": "oficios", "busqueda": "Offset Carry Pot Serve"},
      {"evento": "IdleCartTravelPlayerEnter", "nombre": "Subirse al carro", "categoria": "oficios", "busqueda": "Cart Travel Player Enter"},
      {"evento": "IdleCartTravelPlayerEnterInstant", "nombre": "Subirse al carro (al instante)", "categoria": "oficios", "busqueda": "Cart Travel Player Enter Instant"},
      {"evento": "IdleCartTravelDriverEnter", "nombre": "Subirse al pescante", "categoria": "oficios", "busqueda": "Cart Travel Driver Enter"},
      {"evento": "IdleCartTravelDriverEnterInstant", "nombre": "Subirse al pescante (al instante)", "categoria": "oficios", "busqueda": "Cart Travel Driver Enter Instant"},
      {"evento": "IdlePullChain", "nombre": "Tirar de la cadena", "categoria": "oficios", "busqueda": "Pull Chain Enter"},
      {"evento": "IdleBlackSmithingEnterStart", "nombre": "Trabajar en la forja", "categoria": "oficios", "busqueda": "Black Smithing Enter", "destacada": true},
      {"evento": "IdleBlackSmithEnterInstant", "nombre": "Trabajar en la forja (al instante)", "categoria": "oficios", "busqueda": "Black Smithing Instant"},
      {"evento": "IdleSell", "nombre": "Vender algo", "categoria": "oficios", "busqueda": "Sell"},
      {"evento": "IdleTGFalmerStatueEnter", "nombre": "Ante la estatua falmer", "categoria": "otras", "busqueda": "TG Falmer Statue Enter"},
      {"evento": "IdleTGStatueEnterInstant", "nombre": "Ante la estatua falmer (al instante)", "categoria": "otras", "busqueda": "TG Falmer Statue Enter Instant"},
      {"evento": "IdleTG08_Phase1", "nombre": "Ceremonia del Gremio: fase 1", "categoria": "otras", "busqueda": "TG08 Ceremony Enter"},
      {"evento": "IdleTG08_Phase1_EnterInstant", "nombre": "Ceremonia del Gremio: fase 1 (al instante)", "categoria": "otras", "busqueda": "TG08 Ceremony Enter Instant"},
      {"evento": "IdleTG08_Phase2", "nombre": "Ceremonia del Gremio: fase 2", "categoria": "otras", "busqueda": "TG08 Phase2"},
      {"evento": "IdleTG08_Phase3", "nombre": "Ceremonia del Gremio: fase 3", "categoria": "otras", "busqueda": "TG08 Phase3"},
      {"evento": "IdleTG08_Phase4", "nombre": "Ceremonia del Gremio: fase 4", "categoria": "otras", "busqueda": "TG08 Phase4"},
      {"evento": "IdleTG08_Phase5", "nombre": "Ceremonia del Gremio: fase 5", "categoria": "otras", "busqueda": "TG08 Phase5"},
      {"evento": "IdleCraftingCookingPotTalkA", "nombre": "Cocinar y hablar (A)", "categoria": "otras", "busqueda": "Crafting Cooking Pot Talk A"},
      {"evento": "IdleCraftingCookingPotTalkB", "nombre": "Cocinar y hablar (B)", "categoria": "otras", "busqueda": "Crafting Cooking Pot Talk B"},
      {"evento": "IdleCraftingCookingPotAddIngredient", "nombre": "Echar un ingrediente al puchero", "categoria": "otras", "busqueda": "Crafting Cooking Pot Add Ingredient"},
      {"evento": "IdleDLC02BoatRide", "nombre": "Ir en barca", "categoria": "otras", "busqueda": "DLC02 Boat Ride"},
      {"evento": "WardBreak", "nombre": "Se rompe la protección", "categoria": "otras", "busqueda": "Ward Broken"},
      {"evento": "IdleRailLeanEnter", "nombre": "Apoyarse en la baranda", "categoria": "sentarse", "busqueda": "Rail Lean Enter", "destacada": true},
      {"evento": "IdleRailLeanEnterInstant", "nombre": "Apoyarse en la baranda (al instante)", "categoria": "sentarse", "busqueda": "Rail Lean Enter Instant"},
      {"evento": "IdleBarCounterEnter", "nombre": "Apoyarse en la barra", "categoria": "sentarse", "busqueda": "Bar Counter Enter"},
      {"evento": "IdleBarCounterEnterInstant", "nombre": "Apoyarse en la barra (al instante)", "categoria": "sentarse", "busqueda": "Bar Counter Enter Instant"},
      {"evento": "IdleTableLeanPoint", "nombre": "Apoyarse en la mesa y señalar", "categoria": "sentarse", "busqueda": "Table Lean Point"},
      {"evento": "IdleWallLeanStart", "nombre": "Apoyarse en la pared", "categoria": "sentarse", "busqueda": "Enter Wall Lean", "destacada": true},
      {"evento": "IdleWallLeanEnterInstant", "nombre": "Apoyarse en la pared (al instante)", "categoria": "sentarse", "busqueda": "Wall Lean Enter Instant"},
      {"evento": "IdleAltarEnter", "nombre": "Arrodillarse en el altar", "categoria": "sentarse", "busqueda": "Altar Enter Left"},
      {"evento": "IdleAltarEnterInstant", "nombre": "Arrodillarse en el altar (al instante)", "categoria": "sentarse", "busqueda": "Altar Enter Instant Left"},
      {"evento": "IdleWallCornerPeekREnterInstant", "nombre": "Asomarse por la esquina derecha (al instante)", "categoria": "sentarse", "busqueda": "Wall Corner Peek R Enter Instant"},
      {"evento": "IdleWallCornerPeekLEnterInstant", "nombre": "Asomarse por la esquina izquierda (al instante)", "categoria": "sentarse", "busqueda": "Wall Corner Peek L Enter Instant"},
      {"evento": "IdleWallCornerPeekREnter", "nombre": "Asomarse por la esquina, a la derecha", "categoria": "sentarse", "busqueda": "Wall Corner Peek R Enter"},
      {"evento": "IdleWallCornerPeekLEnter", "nombre": "Asomarse por la esquina, a la izquierda", "categoria": "sentarse", "busqueda": "Wall Corner Peek L Enter"},
      {"evento": "ChairDrinkingStart", "nombre": "Beber sentado", "categoria": "sentarse", "busqueda": "Chair Drinking Start"},
      {"evento": "ChairEatingStart_VampireMeat", "nombre": "Comer carne cruda sentado (vampiro)", "categoria": "sentarse", "busqueda": "Chair Eating Vampire Meat"},
      {"evento": "ChairEatingStart", "nombre": "Comer sentado", "categoria": "sentarse", "busqueda": "Chair Eating Start"},
      {"evento": "IdleRailLeanExit", "nombre": "Dejar de apoyarse en la baranda", "categoria": "sentarse", "busqueda": "Rail Lean Exit"},
      {"evento": "IdleLounge_Exit", "nombre": "Dejar de repantigarse", "categoria": "sentarse", "busqueda": "Shelf Exit"},
      {"evento": "IdleTablePassOutEnter", "nombre": "Desplomarse sobre la mesa", "categoria": "sentarse", "busqueda": "Table Pass Out Enter Loose"},
      {"evento": "IdleHideREnter", "nombre": "Esconderse a la derecha", "categoria": "sentarse", "busqueda": "Hide R Enter"},
      {"evento": "IdleHideREnterInstant", "nombre": "Esconderse a la derecha (al instante)", "categoria": "sentarse", "busqueda": "Hide R Enter Instant"},
      {"evento": "IdleChairWrite", "nombre": "Escribir sentado", "categoria": "sentarse", "busqueda": "Chair Write"},
      {"evento": "ChairReadingStart", "nombre": "Leer sentado", "categoria": "sentarse", "busqueda": "Book Sitting Reading"},
      {"evento": "ChairReadingIdles", "nombre": "Leer sentado: pasar páginas", "categoria": "sentarse", "busqueda": "Book Sitting Turn Many Pages"},
      {"evento": "IdleChairFrontExit", "nombre": "Levantarse de frente", "categoria": "sentarse", "busqueda": "Exit Chair Front"},
      {"evento": "IdleChairFrontQuickExit", "nombre": "Levantarse de frente, rápido", "categoria": "sentarse", "busqueda": "Exit Chair Front Quick"},
      {"evento": "IdleTableBackExit", "nombre": "Levantarse de la mesa", "categoria": "sentarse", "busqueda": "Exit Chair Back Quick"},
      {"evento": "IdleChairExitStart", "nombre": "Levantarse de la silla", "categoria": "sentarse", "busqueda": "Hadvar Write Ledger Exit"},
      {"evento": "IdleWriteTableChairRightExit", "nombre": "Levantarse del escritorio por la derecha", "categoria": "sentarse", "busqueda": "Write Table Chair Exit Right"},
      {"evento": "IdleWriteTableChairLeftExit", "nombre": "Levantarse del escritorio por la izquierda", "categoria": "sentarse", "busqueda": "Write Table Chair Exit Left"},
      {"evento": "IdleStoolBackExit", "nombre": "Levantarse del taburete", "categoria": "sentarse", "busqueda": "Stool Exit"},
      {"evento": "idleChairRightExit", "nombre": "Levantarse por la derecha", "categoria": "sentarse", "busqueda": "Exit Chair Right"},
      {"evento": "IdleChairRightQuickExit", "nombre": "Levantarse por la derecha, rápido", "categoria": "sentarse", "busqueda": "Exit Chair Right Quick"},
      {"evento": "idleChairLeftExit", "nombre": "Levantarse por la izquierda", "categoria": "sentarse", "busqueda": "Exit Chair Left"},
      {"evento": "IdleChairLeftQuickExit", "nombre": "Levantarse por la izquierda, rápido", "categoria": "sentarse", "busqueda": "Exit Chair Left Quick"},
      {"evento": "IdleBarCounterWipe", "nombre": "Limpiar la barra", "categoria": "sentarse", "busqueda": "Bar Counter Wipe"},
      {"evento": "IdleChairCHILDFrontExit", "nombre": "Niño: levantarse de frente", "categoria": "sentarse", "busqueda": "Exit Chair CHILD Front"},
      {"evento": "IdleChairCHILDRightExit", "nombre": "Niño: levantarse por la derecha", "categoria": "sentarse", "busqueda": "Exit Chair CHILD Right"},
      {"evento": "IdleChairCHILDLeftExit", "nombre": "Niño: levantarse por la izquierda", "categoria": "sentarse", "busqueda": "Exit Chair CHILD Left"},
      {"evento": "IdleChairCHILDEnterInstant", "nombre": "Niño: sentarse (al instante)", "categoria": "sentarse", "busqueda": "Enter Chair CHILD Instant"},
      {"evento": "IdleChairCHILDFrontEnter", "nombre": "Niño: sentarse de frente", "categoria": "sentarse", "busqueda": "Enter Chair CHILD Front"},
      {"evento": "IdleChairCHILDRightEnter", "nombre": "Niño: sentarse por la derecha", "categoria": "sentarse", "busqueda": "Enter Chair CHILD Right"},
      {"evento": "IdleChairCHILDLeftEnter", "nombre": "Niño: sentarse por la izquierda", "categoria": "sentarse", "busqueda": "Enter Chair CHILD Left"},
      {"evento": "IdleCounterStart", "nombre": "Ponerse tras el mostrador", "categoria": "sentarse", "busqueda": "Counter Start"},
      {"evento": "IdleCounterEnterInstant", "nombre": "Ponerse tras el mostrador (al instante)", "categoria": "sentarse", "busqueda": "Counter Enter Instant"},
      {"evento": "IdleSnowElfPrinceChairDialogue", "nombre": "Príncipe elfo de las nieves: hablar sentado", "categoria": "sentarse", "busqueda": "Snow Elf Prince Dialogue"},
      {"evento": "IdleSnowElfPrinceFireAndForget", "nombre": "Príncipe elfo de las nieves: hechizo sentado", "categoria": "sentarse", "busqueda": "Snow Elf Prince Chair Fire And Forget"},
      {"evento": "IdleLounge", "nombre": "Repantigarse", "categoria": "sentarse", "busqueda": "Shelf Enter Instant", "destacada": true},
      {"evento": "idleChairArmsCrossedVar1", "nombre": "Sentado, brazos cruzados", "categoria": "sentarse", "busqueda": "Sitting Chair Arms Crossed Var1"},
      {"evento": "idleChairArmsCrossedVar2", "nombre": "Sentado, brazos cruzados (2)", "categoria": "sentarse", "busqueda": "Sitting Chair Arms Crossed Var2"},
      {"evento": "idleChairShoulderFlex", "nombre": "Sentado, estirar los hombros", "categoria": "sentarse", "busqueda": "Sitting Chair Shoulder Flex"},
      {"evento": "idleChairLookDown", "nombre": "Sentado, mirando al suelo", "categoria": "sentarse", "busqueda": "Sitting Chair Look Down"},
      {"evento": "IdleChairVar1", "nombre": "Sentado, quieto", "categoria": "sentarse", "busqueda": "Sitting Chair Var1"},
      {"evento": "idleChairVar2", "nombre": "Sentado, quieto (2)", "categoria": "sentarse", "busqueda": "Sitting Chair Var2"},
      {"evento": "IdleChairEnterInstant", "nombre": "Sentarse (al instante)", "categoria": "sentarse", "busqueda": "Enter Chair Instant"},
      {"evento": "IdleWriteTableChairEnterInstant", "nombre": "Sentarse a escribir (al instante)", "categoria": "sentarse", "busqueda": "Write Table Chair Enter Instant"},
      {"evento": "IdleWriteTableChairRightEnter", "nombre": "Sentarse a escribir por la derecha", "categoria": "sentarse", "busqueda": "Write Table Chair Enter Right"},
      {"evento": "IdleWriteTableChairLeftEnter", "nombre": "Sentarse a escribir por la izquierda", "categoria": "sentarse", "busqueda": "Write Table Chair Enter Left"},
      {"evento": "IdleTableDrinkEnter", "nombre": "Sentarse a la mesa a beber", "categoria": "sentarse", "busqueda": "Table Drink Enter Loose"},
      {"evento": "IdleTableDrinkAndMugEnter", "nombre": "Sentarse a la mesa con jarra y bebida", "categoria": "sentarse", "busqueda": "Table Drink And Mug Enter Loose"},
      {"evento": "IdleTableMugEnter", "nombre": "Sentarse a la mesa con una jarra", "categoria": "sentarse", "busqueda": "Table Mug Enter Loose"},
      {"evento": "IdleChairFrontEnter", "nombre": "Sentarse de frente", "categoria": "sentarse", "busqueda": "Enter Chair Front", "destacada": true},
      {"evento": "IdleStoolEnter", "nombre": "Sentarse en el taburete", "categoria": "sentarse", "busqueda": "Stool Enter", "destacada": true},
      {"evento": "IdleStoolEnterInstant", "nombre": "Sentarse en el taburete (al instante)", "categoria": "sentarse", "busqueda": "Stool Enter Instant"},
      {"evento": "IdleJarlChairEnter", "nombre": "Sentarse en el trono del jarl", "categoria": "sentarse", "busqueda": "Jarl Chair Enter"},
      {"evento": "IdleJarlChairEnterInstant", "nombre": "Sentarse en el trono del jarl (al instante)", "categoria": "sentarse", "busqueda": "Jarl Chair Enter Instant"},
      {"evento": "IdleChairRightEnter", "nombre": "Sentarse por la derecha", "categoria": "sentarse", "busqueda": "Enter Chair Right"},
      {"evento": "IdleChairLeftEnter", "nombre": "Sentarse por la izquierda", "categoria": "sentarse", "busqueda": "Enter Chair Left"},
      {"evento": "IdleWallSoldierEnter", "nombre": "Soldado apostado en la muralla", "categoria": "sentarse", "busqueda": "Soldier Wall Enter"},
      {"evento": "IdleWallSoldierEnterInstant", "nombre": "Soldado apostado en la muralla (al instante)", "categoria": "sentarse", "busqueda": "Soldier Wall Enter Instant"},
      {"evento": "ChairEatingSoupStart", "nombre": "Tomar sopa sentado", "categoria": "sentarse", "busqueda": "Chair Eating Soup Start"},
      {"evento": "ChairVampireEatingStart", "nombre": "Vampiro: beber sentado", "categoria": "sentarse", "busqueda": "Vampire Chair Drinking"}
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
  function reconstruirIndice() {
    porEvento = {};
    var palabrasDe = {};
    for (var c = 0; c < catalogo.categorias.length; c++) {
      palabrasDe[catalogo.categorias[c].clave] = catalogo.categorias[c].busqueda || '';
    }
    for (var i = 0; i < catalogo.animaciones.length; i++) {
      var a = catalogo.animaciones[i];
      porEvento[a.evento] = a;
      a._busca = sinAcentos(a.nombre + ' ' + a.evento + ' ' +
                            (a.busqueda || '') + ' ' + (palabrasDe[a.categoria] || ''));
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
         dure el bucle. Se decide una vez, al pedirla. */
      if (TERCERA_PERSONA && peticion.origen !== 'bucle') Reproductor.aTerceraPersona();

      try {
        sp.Debug.sendAnimationEvent(actor, peticion.evento);
        // Las repeticiones del bucle no se apuntan: seria una linea cada tres
        // segundos para siempre, y el registro deja de servir para nada.
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
     * Devuelve al personaje a su postura normal.
     *
     * Se mandan dos eventos, y en este orden, porque hacen cosas distintas:
     * IdleFurnitureExit saca de una silla o una cama (si no estas en una, no
     * hace nada), y IdleForceDefaultState corta cualquier pose y vuelve al
     * estado por defecto del grafo. Con solo el segundo te quedas de pie
     * dentro de la silla.
     */
    parar: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;
      try {
        sp.Debug.sendAnimationEvent(actor, 'IdleFurnitureExit');
        sp.Debug.sendAnimationEvent(actor, 'IdleForceDefaultState');
        apuntar('animacion parada');
        return true;
      } catch (e) {
        apuntar('fallo al parar: ' + e);
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

  /**
   * LA PUERTA UNICA. Todo lo que quiera una animacion pasa por aqui.
   *
   * Se normaliza la peticion antes de mandarla para que el transporte reciba
   * siempre lo mismo, venga de la interfaz, de una tecla o de la red.
   */
  function pedirAnimacion(peticion) {
    var limpia = {
      evento: String((peticion && peticion.evento) || ''),
      quien: (peticion && peticion.quien) || FORMID_JUGADOR,
      origen: (peticion && peticion.origen) || 'desconocido'
    };
    if (!limpia.evento) return false;

    var llevar = Transportes[TRANSPORTE] || Transportes.local;
    var hecho = llevar(limpia);
    if (hecho) avisarA(observadoresReproducir, limpia);
    return hecho;
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

  function pedirParar(origen, quien) {
    Bucle.quitar();          // parar es parar: si habia bucle, se acaba
    var peticion = { quien: quien || FORMID_JUGADOR, origen: origen || 'desconocido' };
    var hecho = Reproductor.parar(peticion);
    if (hecho) avisarA(observadoresParar, peticion);
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
      '#' + ID + '{position:fixed;top:0;right:24px;z-index:9000;',
      '  font-family:"Din-pro",sans-serif;font-size:13px;color:#e9e1cf;',
      '  pointer-events:none;user-select:none}',
      '#' + ID + ' *{box-sizing:border-box}',

      /* El panel, descolgado del borde de arriba. No hay pestana ni nada que
         pulsar antes: con la tecla aparece esto directamente. Por eso no lleva
         borde arriba, para que se vea pegado al canto de la pantalla. */
      '#' + ID + ' .ap-panel{pointer-events:auto;position:relative;width:410px;',
      '  max-height:74vh;display:none;flex-direction:column;',
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
      '#' + ID + ' .ap-titulo{font-family:"Bankir-Retro",serif;font-size:15px;',
      '  letter-spacing:2px;text-transform:uppercase;color:#e8c987;',
      '  text-shadow:0 1px 2px rgba(0,0,0,.8)}',
      /* A la derecha del titulo, en pequeno: que parte de la lista se esta
         viendo. Antes esto ocupaba el titulo entero, pero sin la pestana
         encima ya no habia nada que dijera de que va esta ventana. */
      '#' + ID + ' .ap-donde{flex:1;font-size:11px;color:#b9ae94;',
      '  text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-cerrar{cursor:pointer;color:#b9ae94;font-size:15px;',
      '  line-height:1;padding:2px 4px}',
      '#' + ID + ' .ap-cerrar:hover{color:#e8c987}',

      '#' + ID + ' .ap-buscar{width:100%;padding:7px 9px;margin-bottom:8px;',
      '  background:rgba(0,0,0,.45);border:1px solid #6b5a3a;border-radius:3px;',
      '  color:#e9e1cf;font-family:inherit;font-size:13px;outline:none}',
      '#' + ID + ' .ap-buscar:focus{border-color:#c9a35a;',
      '  box-shadow:0 0 6px rgba(201,163,90,.3)}',
      '#' + ID + ' .ap-buscar::placeholder{color:#8a7f68}',

      '#' + ID + ' .ap-categorias{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}',
      '#' + ID + ' .ap-chip{cursor:pointer;padding:3px 8px;font-size:11px;',
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

      '#' + ID + ' .ap-grupo{font-family:"Bankir-Retro",serif;font-size:10px;',
      '  letter-spacing:2px;text-transform:uppercase;color:#c9a35a;',
      '  padding:9px 2px 4px;border-bottom:1px solid rgba(107,90,58,.35);',
      '  margin-bottom:3px}',

      '#' + ID + ' .ap-fila{display:flex;align-items:baseline;gap:8px;cursor:pointer;',
      '  padding:5px 7px;border:1px solid transparent;border-radius:2px}',
      '#' + ID + ' .ap-fila:hover,#' + ID + ' .ap-fila.ap-elegida{',
      '  background:rgba(201,163,90,.12);border-color:#6b5a3a}',
      '#' + ID + ' .ap-nombre{flex:1;min-width:0;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-evento{font-size:10px;color:#8a7f68;max-width:33%;',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

      /* La estrella de favorito. Gris apagada cuando no lo es, dorada cuando
         si. Se queda siempre en su sitio, tambien apagada, para que se vea
         que se puede pulsar sin tener que pasar el raton por encima. */
      '#' + ID + ' .ap-estrella{flex:none;width:16px;text-align:center;',
      '  font-size:13px;line-height:1;color:#4a4034;cursor:pointer}',
      '#' + ID + ' .ap-estrella:hover{color:#b9ae94}',
      '#' + ID + ' .ap-estrella.ap-puesta{color:#e8c987;',
      '  text-shadow:0 0 5px rgba(232,201,135,.45)}',
      '#' + ID + ' .ap-estrella.ap-puesta:hover{color:#fff0cd}',
      '#' + ID + ' .ap-fila.ap-sinsinc .ap-nombre::after{content:" ·solo tu";',
      '  font-size:10px;color:#a8712f}',

      '#' + ID + ' .ap-vacio{padding:18px 4px;text-align:center;color:#b9ae94}',

      '#' + ID + ' .ap-pie{display:flex;align-items:center;gap:8px;',
      '  margin-top:9px;padding-top:8px;',
      '  border-top:1px solid rgba(107,90,58,.6);font-size:11px;color:#b9ae94}',
      '#' + ID + ' .ap-ahora{flex:1;min-width:0;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-boton{cursor:pointer;padding:4px 11px;font-size:11px;',
      '  letter-spacing:.5px;text-transform:uppercase;color:#d9c48f;',
      '  background:linear-gradient(180deg,rgba(60,48,33,.95),rgba(30,24,17,.95));',
      '  border:1px solid #6b5a3a;border-radius:3px}',
      '#' + ID + ' .ap-boton:hover{color:#e8c987;border-color:#c9a35a}',

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
    raiz.innerHTML =
      '<div class="ap-panel">' +
      '  <div class="ap-cabecera"><div class="ap-titulo">Animaciones</div>' +
      '    <div class="ap-donde">Recomendadas</div>' +
      '    <div class="ap-cerrar" title="Cerrar (Esc)">&#10005;</div></div>' +
      '  <input class="ap-buscar" type="text" spellcheck="false"' +
      '         placeholder="Buscar: sentarse, laúd, rezar...">' +
      '  <div class="ap-categorias"></div>' +
      '  <div class="ap-lista"></div>' +
      '  <div class="ap-pie"><div class="ap-ahora">Nada en marcha</div>' +
      '    <div class="ap-bucle" title="Repetirla hasta que pulses Parar">' +
      '      <span class="ap-casilla"></span><span>En bucle</span></div>' +
      '    <div class="ap-boton ap-parar">Parar</div></div>' +
      '</div>';
    document.body.appendChild(raiz);

    var caja = raiz.querySelector('.ap-buscar');
    var chips = raiz.querySelector('.ap-categorias');
    var lista = raiz.querySelector('.ap-lista');
    var ahora = raiz.querySelector('.ap-ahora');
    var donde = raiz.querySelector('.ap-donde');
    var bucle = raiz.querySelector('.ap-bucle');

    /* ------------------------------------------------------------------ estado */
    var animaciones = [];
    var categorias = [];
    var categoria = '';        // '' es "todas"
    var elegida = 0;           // para moverse con las flechas
    var abierto = false;
    var enBucle = false;       // la casilla del pie
    var ultima = null;         // la ultima animacion pedida, para el bucle
    var favorito = {};         // evento -> true, lo que dicen las estrellas

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
         que ir instantanea.

         Se junta lo suyo con las palabras de su categoria, que es lo que
         permite escribir "sentarse" y que salgan las sillas aunque ninguna se
         llame asi (se llaman "Chair Front Enter"). Las palabras de la
         categoria no se repiten en cada ficha del catalogo justamente por
         esto: se pegan aqui. */
      var palabrasDe = {};
      for (var c = 0; c < categorias.length; c++) {
        palabrasDe[categorias[c].clave] = categorias[c].busqueda || '';
      }
      for (var i = 0; i < animaciones.length; i++) {
        var a = animaciones[i];
        a._busca = llano(a.nombre + ' ' + a.evento + ' ' +
                         (a.busqueda || '') + ' ' +
                         (palabrasDe[a.categoria] || ''));
      }
      pintarCategorias();
      pintar();
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
        } else if (categoria && a.categoria !== categoria) {
          continue;
        }
        if (soloLoDeSiempre && !a.destacada && !favorito[a.evento]) continue;
        var vale = true;
        for (var p = 0; p < partes.length; p++) {
          if (a._busca.indexOf(partes[p]) === -1) { vale = false; break; }
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

    function pintarCategorias() {
      var html = ['<div class="ap-chip' + (categoria ? '' : ' ap-puesto') +
                  '" data-cat="">Recomendadas</div>'];

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
      donde.textContent = caja.value.trim()
        ? r.lista.length + (r.lista.length === 1 ? ' resultado' : ' resultados')
        : (categoria ? nombreDe(categoria) : 'Recomendadas');
      var viva = lista.querySelector('.ap-elegida');
      if (viva && viva.scrollIntoView) viva.scrollIntoView({ block: 'nearest' });
    }

    function nombreDe(clave) {
      if (clave === 'favoritos') return '\u2605 Favoritos';
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
    function reproducir(evento) {
      if (!evento) return;
      ultima = evento;
      for (var i = 0; i < animaciones.length; i++) {
        if (animaciones[i].evento === evento) {
          ahora.textContent = animaciones[i].nombre + (enBucle ? '  ·  en bucle' : '');
          ahora.title = evento;
          break;
        }
      }
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
      caja.focus();
      caja.select();
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
    raiz.querySelector('.ap-parar').addEventListener('click', function () {
      ahora.textContent = 'Nada en marcha';
      ahora.removeAttribute('title');
      ultima = null;
      avisar('parar');
    });

    /* La casilla del bucle. Marcarla con algo ya en marcha lo pone en bucle
       ahora mismo, sin tener que volver a pulsar la animacion; desmarcarla lo
       corta pero deja la pose como esta, que para eso no es el boton de parar. */
    bucle.addEventListener('click', function () {
      enBucle = !enBucle;
      bucle.classList.toggle('ap-puesto', enBucle);
      if (ultima) {
        avisar('bucle', { activo: enBucle, evento: ultima });
        var nombre = ahora.textContent.split('  ·  ')[0];
        ahora.textContent = nombre + (enBucle ? '  ·  en bucle' : '');
      }
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
        pintar();
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
    // El update es un contexto nativo valido, que es justo lo que el bucle
    // necesita para volver a mandar la animacion.
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

  function decirAlPanel(metodo) {
    try {
      sp.browser.executeJavaScript(
        'if (window.__animplayer) window.__animplayer.' + metodo + '();');
    } catch (e) { /* si la pagina no esta, no hay nada que decir */ }
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
       combate se quedan como estaban, igual que hace el mod de inventario. */
    if (QUITAR_MOVIMIENTO) {
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

  sp.on('buttonEvent', function (e) {
    if (!e || !e.isDown || e.isRepeating) return;
    if (e.code !== TECLA) return;
    if (!abierto && !sePuedeAbrir()) {
      apuntar('tecla ignorada: el mundo todavia se esta cargando');
      return;
    }
    // Abrir toca el juego (quitar el movimiento), asi que va por la cola.
    encolar(alternar);
  });

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
    if (typeof crudo !== 'string' || crudo.indexOf('animplayer:') === -1) return;

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
          if (partes[j] && a._busca.indexOf(partes[j]) === -1) { vale = false; break; }
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
