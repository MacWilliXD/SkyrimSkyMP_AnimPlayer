/* ===========================================================================
 * AnimPlayer — reproductor de animaciones para SkyMP / SkyrimPlatform
 * ===========================================================================
 *
 * QUE ES
 *   Un panel que baja desde la esquina de arriba a la derecha con la lista de
 *   animaciones de Skyrim y una barra de busqueda. Escribes, pulsas una, y tu
 *   personaje la hace. Se abre y se cierra con F3.
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
  var PESTANA = opcion('pestana', 'auto');      // auto | siempre | nunca

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
      {"clave": "musica", "nombre": "Musica y fiesta", "busqueda": "musica bailar tocar laud flauta tambor aplaudir animar cuerno vitorear"},
      {"clave": "magia", "nombre": "Magia y rituales", "busqueda": "rezar orar ritual altar bendicion meditar pergamino transformarse"},
      {"clave": "leer", "nombre": "Leer y estudiar", "busqueda": "leer libro estudiar nota pergamino traducir pagina"},
      {"clave": "gestos", "nombre": "Gestos y expresion", "busqueda": "saludar senalar reir asentir rendirse burlarse gesto encogerse pose"},
      {"clave": "dialogo", "nombre": "Dialogo", "busqueda": "hablar conversar charlar discutir responder"},
      {"clave": "herido", "nombre": "Herido y muerte", "busqueda": "herido dolor morir sangrar toser levantarse atado ejecucion"},
      {"clave": "control", "nombre": "Control", "busqueda": "parar detener cancelar"},
      {"clave": "otras", "nombre": "Otras", "busqueda": ""}
    ],
    "animaciones": [
      {"evento": "ExecutionNextClip", "nombre": "00 Next Clip", "categoria": "combate"},
      {"evento": "pa_KillMove1HMBackStab", "nombre": "1 HM Kill Move Back Stab", "categoria": "combate"},
      {"evento": "pa_KillMoveBearA", "nombre": "1 HM Kill Move Bear A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMBearB", "nombre": "1 HM Kill Move Bear B", "categoria": "combate"},
      {"evento": "pa_KillingBlow", "nombre": "1 HM Kill Move Bleed Out Kill", "categoria": "combate"},
      {"evento": "pa_KillMoveC", "nombre": "1 HM Kill Move C", "categoria": "combate"},
      {"evento": "pa_KillMove1HMChaurusFlyerKick", "nombre": "1 HM Kill Move Chaurus Flyer Kick", "categoria": "combate"},
      {"evento": "pa_KillMoveD", "nombre": "1 HM Kill Move D", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecapBleedOut", "nombre": "1 HM Kill Move Decap Bleed Out", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecapKnife", "nombre": "1 HM Kill Move Decap Knife", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDragonRodeoSlash", "nombre": "1 HM Kill Move Dragon Rodeo Slash", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDragonRodeoStabShort", "nombre": "1 HM Kill Move Dragon Rodeo Stab Short", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugr", "nombre": "1 HM Kill Move Draugr A", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugrB", "nombre": "1 HM Kill Move Draugr B", "categoria": "combate"},
      {"evento": "pa_KillMoveDraugrShortA", "nombre": "1 HM Kill Move Draugr Short A", "categoria": "combate"},
      {"evento": "pa_KillMoveDualWieldA", "nombre": "1 HM Kill Move Dual Wield A", "categoria": "combate"},
      {"evento": "pa_KillMoveF", "nombre": "1 HM Kill Move F", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerA", "nombre": "1 HM Kill Move Falmer A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerB", "nombre": "1 HM Kill Move Falmer B", "categoria": "combate"},
      {"evento": "pa_KillMove1HMFalmerC", "nombre": "1 HM Kill Move Falmer C", "categoria": "combate"},
      {"evento": "pa_KillMoveGiantA", "nombre": "1 HM Kill Move Giant A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMGiantB", "nombre": "1 HM Kill Move Giant B", "categoria": "combate"},
      {"evento": "pa_KillMove1HMGiantBleedOutA", "nombre": "1 HM Kill Move Giant Bleed Out A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMHagravenA", "nombre": "1 HM Kill Move Hagraven A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMHagravenB", "nombre": "1 HM Kill Move Hagraven B", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCat", "nombre": "1 HM Kill Move Sabre Cat", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCatShortA", "nombre": "1 HM Kill Move Sabre Cat Short A", "categoria": "combate"},
      {"evento": "pa_KillMoveSabreCatShortB", "nombre": "1 HM Kill Move Sabre Cat Short B", "categoria": "combate"},
      {"evento": "pa_KillMoveShortA", "nombre": "1 HM Kill Move Short A", "categoria": "combate"},
      {"evento": "pa_KillMoveShortB", "nombre": "1 HM Kill Move Short B", "categoria": "combate"},
      {"evento": "pa_KillMoveShortC", "nombre": "1 HM Kill Move Short C", "categoria": "combate"},
      {"evento": "pa_KillMoveShortD", "nombre": "1 HM Kill Move Short D", "categoria": "combate"},
      {"evento": "pa_KillMoveJ", "nombre": "1 HM Kill Move Short J", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSpiderSmashA", "nombre": "1 HM Kill Move Spider Smash A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSpiderStabA", "nombre": "1 HM Kill Move Spider Stab A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSprigganA", "nombre": "1 HM Kill Move Spriggan A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSprigganB", "nombre": "1 HM Kill Move Spriggan B", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSteamCenturionA", "nombre": "1 HM Kill Move Steam Centurion A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMSteamCenturionB", "nombre": "1 HM Kill Move Steam Centurion B", "categoria": "combate"},
      {"evento": "pa_KillMoveTrollA", "nombre": "1 HM Kill Move Troll A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMTrollB", "nombre": "1 HM Kill Move Troll B", "categoria": "combate"},
      {"evento": "pa_KillMove1HMWolfA", "nombre": "1 HM Kill Move Wolf A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMWolfB", "nombre": "1 HM Kill Move Wolf B", "categoria": "combate"},
      {"evento": "pa_KillMoveSneakBackA", "nombre": "1 HM Sneak Kill Back A", "categoria": "combate"},
      {"evento": "pa_KillMove1HMVBSlowBackStab", "nombre": "1 HMVB Slow Back Stab", "categoria": "combate"},
      {"evento": "pa_KillMove1HMVBSoccerKick", "nombre": "1 HMVB Soccer Kick", "categoria": "combate"},
      {"evento": "pa_KillMove2HMBearA", "nombre": "2 HM Kill Move Bear A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMBearB", "nombre": "2 HM Kill Move Bear B", "categoria": "combate"},
      {"evento": "pa_KillMove2HMChaurusFlyerStabDown", "nombre": "2 HM Kill Move Chaurus Flyer", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDecapBleedOut", "nombre": "2 HM Kill Move Decap Bleed Out", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDecap", "nombre": "2 HM Kill Move Decap Slash", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDragonSlash", "nombre": "2 HM Kill Move Dragon Slash", "categoria": "combate"},
      {"evento": "pa_KillMove2HMDraugrA", "nombre": "2 HM Kill Move Draugr A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMFalmerA", "nombre": "2 HM Kill Move Falmer A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMFalmerB", "nombre": "2 HM Kill Move Falmer B", "categoria": "combate"},
      {"evento": "pa_KillMove2HMGiantA", "nombre": "2 HM Kill Move Giant A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMHagravenA", "nombre": "2 HM Kill Move Hagraven A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSabreCatA", "nombre": "2 HM Kill Move Sabre Cat A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSabreCatB", "nombre": "2 HM Kill Move Sabre Cat B", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSpiderSlamA", "nombre": "2 HM Kill Move Spider Slam A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSprigganA", "nombre": "2 HM Kill Move Spriggan A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMStabA", "nombre": "2 HM Kill Move Stab A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMSteamCenturionA", "nombre": "2 HM Kill Move Steam Centurion A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMTrollA", "nombre": "2 HM Kill Move Troll A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMTrollB", "nombre": "2 HM Kill Move Troll B", "categoria": "combate"},
      {"evento": "pa_KillMove2HMVBBlockAndSlash", "nombre": "2 HM Kill Move Vampire Brute", "categoria": "combate"},
      {"evento": "pa_KillMove2HMWolfA", "nombre": "2 HM Kill Move Wolf A", "categoria": "combate"},
      {"evento": "pa_KillMove2HMWolfB", "nombre": "2 HM Kill Move Wolf B", "categoria": "combate"},
      {"evento": "pa_KillMove2HWBearA", "nombre": "2 HW Kill Move Bear A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWChaurusFlyerPullDownSlash", "nombre": "2 HW Kill Move Chaurus Flyer", "categoria": "combate"},
      {"evento": "pa_2HWKillMoveA", "nombre": "2 HW Kill Move Decap A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDragonRodeoSlash", "nombre": "2 HW Kill Move Dragon Rodeo Slash", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDragonSlash", "nombre": "2 HW Kill Move Dragon Slash", "categoria": "combate"},
      {"evento": "pa_KillMove2HWGiantA", "nombre": "2 HW Kill Move Giant A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSabreCatA", "nombre": "2 HW Kill Move Sabre Cat", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSpiderSlamA", "nombre": "2 HW Kill Move Spider Slam A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWSprigganA", "nombre": "2 HW Kill Move Spriggan A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWTrollA", "nombre": "2 HW Kill Move Troll A", "categoria": "combate"},
      {"evento": "pa_KillMove2HWVBBackBreaker", "nombre": "2 HW Kill Move Vampire Brute", "categoria": "combate"},
      {"evento": "pa_KillMove2HWWolfA", "nombre": "2 HW Kill Move Wolf A", "categoria": "combate"},
      {"evento": "Magic_Equip", "nombre": "Attack Left Equip Spell", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapEquip", "nombre": "Attack Left Equip Weapon", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "AttackStartH2HLeft", "nombre": "Attack Left H2 H", "categoria": "combate"},
      {"evento": "attackStart_MC_1HMLeft", "nombre": "Attack Left Side", "categoria": "combate"},
      {"evento": "AttackStartH2HRight", "nombre": "Attack Right H2 H", "categoria": "combate"},
      {"evento": "attackStart_MC_1HMRight", "nombre": "Attack Right Side", "categoria": "combate"},
      {"evento": "bashFail", "nombre": "Bash Fail", "categoria": "combate"},
      {"evento": "BashFail", "nombre": "Bash Fail", "categoria": "combate"},
      {"evento": "bashRelease", "nombre": "Bash Release", "categoria": "combate"},
      {"evento": "bleedOutStart", "nombre": "Bleedout Start", "categoria": "combate"},
      {"evento": "bleedOutStop", "nombre": "Bleedout Stop", "categoria": "combate"},
      {"evento": "blockAnticipateStart", "nombre": "Block Anticipate", "categoria": "combate"},
      {"evento": "blockHitStart", "nombre": "Block Hit", "categoria": "combate"},
      {"evento": "WeapOutRightReplaceForceEquip", "nombre": "Both Hands Change", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "bowAttackStart", "nombre": "Bow Attack", "categoria": "combate"},
      {"evento": "bashStart", "nombre": "Bow Bash", "categoria": "combate"},
      {"evento": "blockStart", "nombre": "Bow Zoom", "categoria": "combate"},
      {"evento": "NPC_BumpFromFront", "nombre": "Bumped From Front", "categoria": "combate"},
      {"evento": "MLh_SpellAimedConcentrationStart", "nombre": "Cast Left Concentration Aimed", "categoria": "combate"},
      {"evento": "MLh_SpellAimedStart", "nombre": "Cast Left Fire Forget Target Actor", "categoria": "combate"},
      {"evento": "RitualSpellAimConcentrationStart", "nombre": "Cast Left Ritual Concentration Aim", "categoria": "combate"},
      {"evento": "RitualSpellStart", "nombre": "Cast Left Ritual Fire And Forget Self", "categoria": "combate"},
      {"evento": "MLh_SpellTelekinesisStart", "nombre": "Cast Left Telekinesis", "categoria": "combate"},
      {"evento": "MLh_WardStart", "nombre": "Cast Left Ward", "categoria": "combate"},
      {"evento": "MRh_SpellSelfStart", "nombre": "Cast Right Fire Forget Self", "categoria": "combate"},
      {"evento": "MRh_SpellAimedStart", "nombre": "Cast Right Fire Forget Target Actor", "categoria": "combate"},
      {"evento": "MRh_SpellTelekinesisStart", "nombre": "Cast Right Telekinesis", "categoria": "combate"},
      {"evento": "MRh_WardStart", "nombre": "Cast Right Ward", "categoria": "combate"},
      {"evento": "moveStart", "nombre": "Character Move Start", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "moveStop", "nombre": "Character Move Stop", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "turnLeft", "nombre": "Character Turn Left", "categoria": "combate"},
      {"evento": "turnRight", "nombre": "Character Turn Right", "categoria": "combate"},
      {"evento": "turnStop", "nombre": "Character Turn Stop", "categoria": "combate", "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "IdleCombatShieldStart", "nombre": "Civil War Shield Cheer", "categoria": "combate"},
      {"evento": "IdleCombatLookingAroundStart", "nombre": "Combat Idle Looking Around", "categoria": "combate"},
      {"evento": "IdleCombatSpecialStart", "nombre": "Combat Idle Special", "categoria": "combate"},
      {"evento": "IdleCombatStart", "nombre": "Combat Idle Stagger Regular", "categoria": "combate"},
      {"evento": "IdleCombatStretchingStart", "nombre": "Combat Idle Stretching", "categoria": "combate"},
      {"evento": "IdleCombatWeaponCheckStart", "nombre": "Combat Idle Weapon Check", "categoria": "combate"},
      {"evento": "crossbowAttackStart", "nombre": "crossbow Attack Start", "categoria": "combate"},
      {"evento": "crossbowDwarvenAttackStart", "nombre": "crossbow Dwarven Attack Start", "categoria": "combate"},
      {"evento": "bowEnd", "nombre": "Crossbow Release During Reload", "categoria": "combate"},
      {"evento": "HorseExit", "nombre": "Dismount", "categoria": "combate"},
      {"evento": "HorseExitSwim", "nombre": "Dismount Swim", "categoria": "combate"},
      {"evento": "pa_DLC1SeranaHoldsVyrthur", "nombre": "DLC1 Serana Holds Vyrthur", "categoria": "combate"},
      {"evento": "DragonMountExit", "nombre": "Dragon Dismount", "categoria": "combate"},
      {"evento": "DragonMountEnter", "nombre": "Dragon Mount", "categoria": "combate"},
      {"evento": "DragonMountEnterInstant", "nombre": "Dragon Mount Instant", "categoria": "combate"},
      {"evento": "attackStartDualWield", "nombre": "Dual Wield Power Attack", "categoria": "combate"},
      {"evento": "attackPowerStartDualWield", "nombre": "Dual Wield Special Power Attack", "categoria": "combate"},
      {"evento": "HorseEnterInstant", "nombre": "Enter Horse Instant", "categoria": "combate"},
      {"evento": "pa_ExtractWerewolfSpirit", "nombre": "Extract Werewolf Spirit", "categoria": "combate"},
      {"evento": "FlinchStart", "nombre": "Flinch", "categoria": "combate"},
      {"evento": "UnequipNoAnim", "nombre": "Force Sheathe", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "Ground_Dismount_Dragon", "nombre": "Ground Dismount Dragon NPC", "categoria": "combate"},
      {"evento": "attackPowerStartForwardH2HLeftHand", "nombre": "H2 H Left Hand Power Attack", "categoria": "combate"},
      {"evento": "attackPowerStartForwardH2HRightHand", "nombre": "H2 H Right Hand Power Attack", "categoria": "combate"},
      {"evento": "pa_HugA", "nombre": "Hug A", "categoria": "combate"},
      {"evento": "MLh_Equipped_Event", "nombre": "Interrupt Left", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_Equipped_Event", "nombre": "Interrupt Right", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "RitualSpellOut", "nombre": "Interrupt Right Ritual Spell", "categoria": "combate"},
      {"evento": "JumpDirectionalStart", "nombre": "Jump Directional Start", "categoria": "combate"},
      {"evento": "JumpFall", "nombre": "Jump Fall", "categoria": "combate"},
      {"evento": "JumpLandDirectional", "nombre": "Jump Land Directional", "categoria": "combate"},
      {"evento": "SwimStart", "nombre": "Jump Land Swimming", "categoria": "combate"},
      {"evento": "JumpLandEnd", "nombre": "Jump Soft End", "categoria": "combate"},
      {"evento": "JumpStandingStart", "nombre": "Jump Standing Start", "categoria": "combate"},
      {"evento": "pa_KillMove1HMDecap", "nombre": "Kill Move Decap Slash", "categoria": "combate"},
      {"evento": "pa_KillMoveDLC02RipHeartOut", "nombre": "Kill Move DLC02 Rip Heart Out", "categoria": "combate"},
      {"evento": "pa_KillMoveDWDecap", "nombre": "Kill Move Dual Wield Decap", "categoria": "combate"},
      {"evento": "pa_KillMoveH2HComboA", "nombre": "Kill Move H2 H Combo A", "categoria": "combate"},
      {"evento": "pa_KillMoveH2HSlamA", "nombre": "Kill Move H2 H Slam", "categoria": "combate"},
      {"evento": "pa_KillMove2HWDecapBleedOut", "nombre": "Kill Move2 HW Decap Bleed Out", "categoria": "combate"},
      {"evento": "attackReleaseL", "nombre": "Left Attack Release", "categoria": "combate"},
      {"evento": "WeapSoloEquip", "nombre": "Left H2 H Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "attackStartLeftHand", "nombre": "Left Hand Attack", "categoria": "combate"},
      {"evento": "attackPowerStartInPlaceLeftHand", "nombre": "Left Hand Power Attack", "categoria": "combate"},
      {"evento": "attackPowerStartBackLeftHand", "nombre": "Left Hand Power Attack Back", "categoria": "combate"},
      {"evento": "attackPowerStartLeftLeftHand", "nombre": "Left Hand Power Attack Left", "categoria": "combate"},
      {"evento": "attackPowerStartRightLeftHand", "nombre": "Left Hand Power Attack Right", "categoria": "combate"},
      {"evento": "MagicForceEquipLeft", "nombre": "Left Magic Force Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "Magic_Solo_Equip", "nombre": "Left Magic Force Unequip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "attackPowerStart_MC_1HMLeft", "nombre": "Left Power Attack", "categoria": "combate"},
      {"evento": "Lever_PlayerPush", "nombre": "Lever Push Player", "categoria": "combate"},
      {"evento": "staggerStart", "nombre": "Loose Full Body Stagger", "categoria": "combate"},
      {"evento": "MRh_SpellRelease_Event", "nombre": "Magic Right Release", "categoria": "combate"},
      {"evento": "MagicWeap_ForceEquip", "nombre": "Magic Weapon Force Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "HorseEnter", "nombre": "Mount", "categoria": "combate"},
      {"evento": "MountedStaggerStart", "nombre": "Mounted Stagger Start", "categoria": "combate"},
      {"evento": "MountedSwimStart", "nombre": "Mounted Swim Start", "categoria": "combate"},
      {"evento": "MountedSwimStop", "nombre": "Mounted Swim Stop", "categoria": "combate"},
      {"evento": "MC_shoutStart", "nombre": "Mounted Voice", "categoria": "combate"},
      {"evento": "attackStart", "nombre": "Normal Attack", "categoria": "combate"},
      {"evento": "Ragdoll", "nombre": "NPC Knock Down", "categoria": "combate"},
      {"evento": "NPC_TurnRight90", "nombre": "NPC Turn Right90 End", "categoria": "combate"},
      {"evento": "NPC_TurnToWalkRight90", "nombre": "NPC Turn To Walk Right90", "categoria": "combate"},
      {"evento": "NPCshoutStart", "nombre": "NPC Voice Start", "categoria": "combate"},
      {"evento": "pa_OffsetBoundStandingCut", "nombre": "Offset Bound Standing Cut", "categoria": "combate"},
      {"evento": "MagicForceEquipRight", "nombre": "Only Right Hand Changes Magic Out", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "StaggerPlayer", "nombre": "Player Stagger", "categoria": "combate"},
      {"evento": "attackPowerStartLeft", "nombre": "Power Attack Left", "categoria": "combate"},
      {"evento": "bashPowerStart", "nombre": "Power Bash", "categoria": "combate"},
      {"evento": "MLh_SpellReady_Event", "nombre": "Ready Left", "categoria": "combate"},
      {"evento": "MRh_SpellReady_Event", "nombre": "Ready Right", "categoria": "combate"},
      {"evento": "recoilStart", "nombre": "Recoil", "categoria": "combate"},
      {"evento": "recoilLargeStart", "nombre": "Recoil Large", "categoria": "combate"},
      {"evento": "MLh_SpellRelease_Event", "nombre": "Release Left", "categoria": "combate"},
      {"evento": "MLH_SpellRelease_event", "nombre": "Release Left", "categoria": "combate"},
      {"evento": "reloadStart", "nombre": "Reload Root", "categoria": "combate"},
      {"evento": "torchUnequip", "nombre": "Removed", "categoria": "combate"},
      {"evento": "attackRelease", "nombre": "Right Attack Release", "categoria": "combate"},
      {"evento": "attackPowerStartH2HCombo", "nombre": "Right H2 H Combo Power Attack", "categoria": "combate"},
      {"evento": "attackPowerStart_MC_1HMRight", "nombre": "Right Power Attack", "categoria": "combate"},
      {"evento": "idleRitualSpellRelease", "nombre": "Ritual Spell Release", "categoria": "combate"},
      {"evento": "idleRitualSpellStart", "nombre": "Ritual Spell Start", "categoria": "combate"},
      {"evento": "ShdEquip", "nombre": "shield Force Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "SneakStart", "nombre": "Sneak Start", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "SneakStop", "nombre": "Sneak Stop", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "SprintStop", "nombre": "Sprint Root Stop", "categoria": "combate"},
      {"evento": "SprintStart", "nombre": "Sprint Start", "categoria": "combate"},
      {"evento": "StaffBashRelease", "nombre": "Staff Bash Release", "categoria": "combate"},
      {"evento": "WeapOutLeftReplaceForceEquip", "nombre": "Staff Magic Shield Torch AND Weap Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "blockStop", "nombre": "Stop Blocking", "categoria": "combate"},
      {"evento": "SwimStop", "nombre": "Swim Stop", "categoria": "combate"},
      {"evento": "swimForceEquip", "nombre": "Swimming Force Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "torchForceEquip", "nombre": "Torch Equip", "categoria": "combate"},
      {"evento": "torchEquip", "nombre": "torch Force Equip", "categoria": "combate"},
      {"evento": "pa_VampireFeedStanding_Back", "nombre": "Vampire Standing Back", "categoria": "combate"},
      {"evento": "pa_VampireFeedStanding_Front", "nombre": "Vampire Standing Feed Front Loose", "categoria": "combate"},
      {"evento": "shoutStop", "nombre": "Voice Interrupt Root", "categoria": "combate"},
      {"evento": "MT_BreathExhaleShort", "nombre": "Voice Release", "categoria": "combate"},
      {"evento": "shoutReleaseSlowTime", "nombre": "Voice Release Slow Time", "categoria": "combate"},
      {"evento": "CombatReady_BreathExhaleShort", "nombre": "Voice Release Weapon Out", "categoria": "combate"},
      {"evento": "shoutStart", "nombre": "Voice Start", "categoria": "combate"},
      {"evento": "ShoutSprintLongestStart", "nombre": "Voice Whirlwind Sprint Long", "categoria": "combate"},
      {"evento": "ShoutSprintLongStart", "nombre": "Voice Whirlwind Sprint Medium", "categoria": "combate"},
      {"evento": "ShoutSprintMediumStart", "nombre": "Voice Whirlwind Sprint Short", "categoria": "combate"},
      {"evento": "wardAbsorb", "nombre": "Ward Absorbed", "categoria": "combate"},
      {"evento": "MC_WeapOutRightReplaceForceEquip", "nombre": "Weapon Right Hand Equip", "categoria": "combate", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "pa_WW_CutWrist", "nombre": "Were Wolf Cut Wrist", "categoria": "combate"},
      {"evento": "idleBarDrinkingStart", "nombre": "Bar Drinking Start", "categoria": "comer"},
      {"evento": "IdleDrink", "nombre": "Drink", "categoria": "comer", "destacada": true},
      {"evento": "IdleDrinkFromFountain", "nombre": "Drink Fountain", "categoria": "comer"},
      {"evento": "IdleDrinkPotion", "nombre": "Drink Potion", "categoria": "comer"},
      {"evento": "idleDrinkingStandingStart", "nombre": "Drinking Standing Start", "categoria": "comer", "destacada": true},
      {"evento": "DrunkStart", "nombre": "Drunk Start", "categoria": "comer"},
      {"evento": "DrunkStop", "nombre": "Drunk Stop", "categoria": "comer"},
      {"evento": "IdleEatSoup", "nombre": "Eat Soup", "categoria": "comer"},
      {"evento": "idleEatingStandingStart", "nombre": "Eating Standing Start", "categoria": "comer", "destacada": true},
      {"evento": "idleEatingStandingStart_DLC1Vampire", "nombre": "Eating Standing Start Vampire Meat", "categoria": "comer"},
      {"evento": "IdleMQ201Drink", "nombre": "MQ201 Drink", "categoria": "comer"},
      {"evento": "IdleMQ201HoldingDrinkTray", "nombre": "MQ201 Holding Drink Tray", "categoria": "comer"},
      {"evento": "IdleMQ201ToastStart", "nombre": "MQ201 Toast Start", "categoria": "comer"},
      {"evento": "OffsetCarryMQ201DrinkR", "nombre": "Offset Carry MQ201 Drink R", "categoria": "comer"},
      {"evento": "OffsetCarryMQ201DrinkTray", "nombre": "Offset Carry MQ201 Drink Tray", "categoria": "comer"},
      {"evento": "IdleTG03UseMeadBarrel", "nombre": "Use Mead Barrel Enter", "categoria": "comer"},
      {"evento": "IdleTG03UseMeadBarrelEnterInstant", "nombre": "Use Mead Barrel Enter Instant", "categoria": "comer"},
      {"evento": "IdleWarmArms", "nombre": "Warm Arms", "categoria": "comer"},
      {"evento": "IdleWarmHands", "nombre": "Warm Hands", "categoria": "comer"},
      {"evento": "IdleWarmHandsCrouched", "nombre": "Warm Hands Crouched", "categoria": "comer"},
      {"evento": "IdleWarmHandsStanding", "nombre": "Warm Hands Standing", "categoria": "comer", "destacada": true},
      {"evento": "IdleFurnitureExit", "nombre": "Levantarse del mueble", "categoria": "control", "busqueda": "levantarse salir silla cama mueble"},
      {"evento": "IdleStopInstant", "nombre": "Parar al instante", "categoria": "control", "busqueda": "parar detener cancelar instante"},
      {"evento": "IdleStop", "nombre": "Parar la animacion", "categoria": "control"},
      {"evento": "IdleForceDefaultState", "nombre": "Parar y volver a la postura normal", "categoria": "control", "busqueda": "parar detener cancelar normal quieto", "destacada": true},
      {"evento": "OffsetStop", "nombre": "Soltar lo que lleva en las manos", "categoria": "control", "busqueda": "soltar dejar manos"},
      {"evento": "RF_OpenStart", "nombre": "Caring", "categoria": "dialogo"},
      {"evento": "MotionDrivenDialogueAngry", "nombre": "Dialogue Angry Motion Driven", "categoria": "dialogo"},
      {"evento": "IdleDialogueDefensiveHandGesture", "nombre": "Dialogue Defensive Hand Gesture", "categoria": "dialogo"},
      {"evento": "MotionDrivenDialogueGeneric", "nombre": "Dialogue Generic Motion Driven", "categoria": "dialogo"},
      {"evento": "IdleDialogueHandOnChinGesture", "nombre": "Dialogue Hand On Chin Gesture", "categoria": "dialogo"},
      {"evento": "IdleDialogueMovingTalkA", "nombre": "Dialogue Moving Talk A", "categoria": "dialogo"},
      {"evento": "IdleDialogueMovingTalkB", "nombre": "Dialogue Moving Talk B", "categoria": "dialogo"},
      {"evento": "IdleDialogueMovingTalkC", "nombre": "Dialogue Moving Talk C", "categoria": "dialogo"},
      {"evento": "IdleDialogueMovingTalkD", "nombre": "Dialogue Moving Talk D", "categoria": "dialogo"},
      {"evento": "DialogueNeutral", "nombre": "Dialogue Neutral Expressive", "categoria": "dialogo"},
      {"evento": "MotionDrivenDialogueNextClip", "nombre": "Dialogue Neutral Shift Motion Driven", "categoria": "dialogo"},
      {"evento": "IdleDialogueWelcomeHandGesture", "nombre": "Dialogue Welcome Hand Gesture", "categoria": "dialogo"},
      {"evento": "PairEnd", "nombre": "DLC1 Pair End", "categoria": "dialogo"},
      {"evento": "RF_PlayfulStart", "nombre": "Flirty", "categoria": "dialogo"},
      {"evento": "RF_GuardedDismissive_In", "nombre": "Guarded Dismissive", "categoria": "dialogo"},
      {"evento": "RF_GuardedInterested_In", "nombre": "Guarded Interested", "categoria": "dialogo"},
      {"evento": "RF_GuardedPleading_In", "nombre": "Guarded Pleading", "categoria": "dialogo"},
      {"evento": "RF_GuardedThrowHands_In", "nombre": "Guarded Throw Hands", "categoria": "dialogo"},
      {"evento": "LooseDialogueResponseNegative", "nombre": "Loose Dialogue Response Negative", "categoria": "dialogo"},
      {"evento": "LooseDialogueResponsePositive", "nombre": "Loose Dialogue Response Positive", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeGuarded", "nombre": "Mood Change Guarded", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeOpen", "nombre": "Mood Change Open", "categoria": "dialogo"},
      {"evento": "RF_MoodChangePlayful", "nombre": "Mood Change Playful", "categoria": "dialogo"},
      {"evento": "RF_MoodChangeSerious", "nombre": "Mood Change Serious", "categoria": "dialogo"},
      {"evento": "RF_OpenDismissive_In", "nombre": "Open Dismissive", "categoria": "dialogo"},
      {"evento": "RF_OpenInterested_In", "nombre": "Open Interested", "categoria": "dialogo"},
      {"evento": "RF_OpenPleading_In", "nombre": "Open Pleading", "categoria": "dialogo"},
      {"evento": "RF_OpenThrowHands_In", "nombre": "Open Throw Hands", "categoria": "dialogo"},
      {"evento": "RF_PlayfulDismissive_In", "nombre": "Playful Dismissive", "categoria": "dialogo"},
      {"evento": "RF_PlayfulInterested_In", "nombre": "Playful Interested", "categoria": "dialogo"},
      {"evento": "RF_PlayfulPleading_In", "nombre": "Playful Pleading", "categoria": "dialogo"},
      {"evento": "RF_PlayfulThrowHands_In", "nombre": "Playful Throw Hands", "categoria": "dialogo"},
      {"evento": "RF_Idle_Out", "nombre": "Romantic Follower Stop", "categoria": "dialogo"},
      {"evento": "RF_SeriousStart", "nombre": "Sarcastic", "categoria": "dialogo"},
      {"evento": "RF_SeriousDismissive_In", "nombre": "Serious Dismissive", "categoria": "dialogo"},
      {"evento": "RF_SeriousInterested_In", "nombre": "Serious Interested", "categoria": "dialogo"},
      {"evento": "RF_SeriousPleading_In", "nombre": "Serious Pleading", "categoria": "dialogo"},
      {"evento": "RF_SeriousThrowHands_In", "nombre": "Serious Throw Hands", "categoria": "dialogo"},
      {"evento": "RF_Shock_Guarded", "nombre": "Shock Guarded", "categoria": "dialogo"},
      {"evento": "RF_Shock_Open", "nombre": "Shock Open", "categoria": "dialogo"},
      {"evento": "RF_Shock_Playful", "nombre": "Shock Playful", "categoria": "dialogo"},
      {"evento": "RF_Shock_Serious", "nombre": "Shock Serious", "categoria": "dialogo"},
      {"evento": "RF_GuardedStart", "nombre": "Standoffish", "categoria": "dialogo"},
      {"evento": "RF_Talk_In", "nombre": "Talk", "categoria": "dialogo"},
      {"evento": "IdleDialogueStart", "nombre": "Talking", "categoria": "dialogo"},
      {"evento": "IdleDialogueAngryStart", "nombre": "Talking Angry", "categoria": "dialogo"},
      {"evento": "IdleDialogueExpressiveStart", "nombre": "Talking Expressive", "categoria": "dialogo"},
      {"evento": "Idle_1stPersonWoozyGetUpFromBed", "nombre": "1st Person Woozy Get Up From Bed", "categoria": "dormir"},
      {"evento": "IdleBedQuickExitStart", "nombre": "Bed Quick Exit", "categoria": "dormir"},
      {"evento": "IdleChildLayOnFloor", "nombre": "Child Lay On Floor Enter", "categoria": "dormir"},
      {"evento": "IdleChildLayOnFloorInstant", "nombre": "Child Lay On Floor Enter Instant", "categoria": "dormir"},
      {"evento": "IdleCoffinEnter", "nombre": "Coffin Enter", "categoria": "dormir"},
      {"evento": "IdleCoffinEnterInstant", "nombre": "Coffin Enter Instant Left", "categoria": "dormir"},
      {"evento": "IdleActivateCoffinPuzzle", "nombre": "DLC1 Coffin Puzzle Bowl Idle", "categoria": "dormir"},
      {"evento": "IdleCoffinHorzEnter", "nombre": "DLC1 Idle Coffin Horz Enter", "categoria": "dormir"},
      {"evento": "IdleCoffinHorzEnterInstant", "nombre": "DLC1 Idle Coffin Horz Enter Instant", "categoria": "dormir"},
      {"evento": "IdleCoffinVertEnter", "nombre": "DLC1 Idle Coffin Vert", "categoria": "dormir"},
      {"evento": "IdleCoffinVertEnterInstant", "nombre": "Dlc1 Idle Coffin Vert Enter Instant", "categoria": "dormir"},
      {"evento": "DLC01CoffinEnterInstant", "nombre": "DLC1 Serana Coffin Enter Instant", "categoria": "dormir"},
      {"evento": "IdleWebEnterInstant", "nombre": "Enter Web Instant", "categoria": "dormir"},
      {"evento": "IdleBedExitStart", "nombre": "Exit Bed", "categoria": "dormir"},
      {"evento": "IdleBedRollFrontEnterStart", "nombre": "Front Bed Roll Enter", "categoria": "dormir"},
      {"evento": "IdleBedRollFrontEnterInstant", "nombre": "Front Bed Roll Enter Instant", "categoria": "dormir"},
      {"evento": "IdleBedLeftEnterStart", "nombre": "Left Bed Enter", "categoria": "dormir", "destacada": true},
      {"evento": "IdleBedLeftEnterInstant", "nombre": "Left Bed Enter Instant", "categoria": "dormir"},
      {"evento": "IdleBedRollLeftEnterStart", "nombre": "Left Bed Roll Enter", "categoria": "dormir"},
      {"evento": "IdleBedRollLeftEnterInstant", "nombre": "Left Bed Roll Enter Instant", "categoria": "dormir"},
      {"evento": "MS12BedDeath", "nombre": "MS12 Bed Death", "categoria": "dormir"},
      {"evento": "IdleBedRightEnterStart", "nombre": "Right Bed Enter", "categoria": "dormir"},
      {"evento": "IdleBedRightEnterInstant", "nombre": "Right Bed Enter Instant", "categoria": "dormir"},
      {"evento": "IdleBedRollRightEnterStart", "nombre": "Right Bed Roll Enter", "categoria": "dormir"},
      {"evento": "IdleBedRollRightEnterInstant", "nombre": "Right Bed Roll Enter Instant", "categoria": "dormir"},
      {"evento": "IdleSleepNod", "nombre": "Sleep Nod", "categoria": "dormir"},
      {"evento": "VampireFeedingBedLeft", "nombre": "Vampire Bed Left", "categoria": "dormir"},
      {"evento": "VampireFeedingBedRight", "nombre": "Vampire Bed Right", "categoria": "dormir"},
      {"evento": "VampireFeedingBedRollLeft", "nombre": "Vampire Bedroll Left", "categoria": "dormir"},
      {"evento": "VampireFeedingBedRollRight", "nombre": "Vampire Bedroll Right", "categoria": "dormir"},
      {"evento": "IdleWebExit", "nombre": "Web Idle Exit", "categoria": "dormir"},
      {"evento": "IdleWebExitQuickTurn", "nombre": "Web Idle Exit Quick Turn", "categoria": "dormir"},
      {"evento": "IdleWebThrashShort", "nombre": "Web Thrash Short", "categoria": "dormir"},
      {"evento": "IdleWebThrashShort2", "nombre": "Web Thrash Short2", "categoria": "dormir"},
      {"evento": "idle_A_left_longTrans", "nombre": "A left long Trans", "categoria": "gestos"},
      {"evento": "idle_A_leg_shift", "nombre": "A leg shift", "categoria": "gestos"},
      {"evento": "idle_A_pull_pants", "nombre": "A pull pants", "categoria": "gestos"},
      {"evento": "idle_A_scratch_back", "nombre": "A scratch back", "categoria": "gestos"},
      {"evento": "idle_A_shakeout", "nombre": "A shakeout", "categoria": "gestos"},
      {"evento": "idle_A_shoulders", "nombre": "A shoulders", "categoria": "gestos"},
      {"evento": "idle_A_shouldersVar1", "nombre": "A shoulders Var1", "categoria": "gestos"},
      {"evento": "idle_A_sigh_var1Trans", "nombre": "A sigh var1 Trans", "categoria": "gestos"},
      {"evento": "idle_A_sigh_var2Trans", "nombre": "A sigh var2 Trans", "categoria": "gestos"},
      {"evento": "idle_A_soft_rightTrans", "nombre": "A soft right trans", "categoria": "gestos"},
      {"evento": "idle_A_swat_flies", "nombre": "A swat flies", "categoria": "gestos"},
      {"evento": "idle_A_sway_fastTrans", "nombre": "A sway fast Trans", "categoria": "gestos"},
      {"evento": "IdleAstridEnter", "nombre": "Astrid", "categoria": "gestos"},
      {"evento": "IdleGrave_01", "nombre": "Bow Head At Grave 01", "categoria": "gestos"},
      {"evento": "IdleGrave_02", "nombre": "Bow Head At Grave 02", "categoria": "gestos"},
      {"evento": "IdleKneeling", "nombre": "Check Corpse", "categoria": "gestos"},
      {"evento": "IdleChildApologize", "nombre": "Child Apologize", "categoria": "gestos"},
      {"evento": "IdleChildCryingEnd", "nombre": "Child Crying End", "categoria": "gestos"},
      {"evento": "IdleChildCryingStart", "nombre": "Child Crying Start", "categoria": "gestos"},
      {"evento": "IdleChildFidget", "nombre": "Child Fidget", "categoria": "gestos"},
      {"evento": "IdleChildLegsOutStart", "nombre": "Child Legs Out", "categoria": "gestos"},
      {"evento": "IdleChildPlayDirt", "nombre": "Child Play Dirt", "categoria": "gestos"},
      {"evento": "IdleChildPlayDoll", "nombre": "Child Play Doll", "categoria": "gestos"},
      {"evento": "IdleChildShy", "nombre": "Child Shy", "categoria": "gestos"},
      {"evento": "IdleChildSitOnKnees", "nombre": "Child Sit On Knees Enter", "categoria": "gestos"},
      {"evento": "IdleChildSitOnKneesInstant", "nombre": "Child Sit On Knees Enter Instant", "categoria": "gestos"},
      {"evento": "IdleChildTaunt1", "nombre": "Child Taunt1", "categoria": "gestos"},
      {"evento": "IdleChildTaunt2", "nombre": "Child Taunt2", "categoria": "gestos"},
      {"evento": "IdleChildTaunt3", "nombre": "Child Taunt3", "categoria": "gestos"},
      {"evento": "IdleChildTaunt4", "nombre": "Child Taunt4", "categoria": "gestos"},
      {"evento": "IdleChildWhineKick", "nombre": "Child Whine Kick", "categoria": "gestos"},
      {"evento": "IdleChildWhineStompFeet", "nombre": "Child Whine Stomp", "categoria": "gestos"},
      {"evento": "IdleCleanSword", "nombre": "Clean Sword", "categoria": "gestos"},
      {"evento": "IdleComeThisWay", "nombre": "Come This Way", "categoria": "gestos", "destacada": true},
      {"evento": "IdleCowering", "nombre": "Cower", "categoria": "gestos", "destacada": true},
      {"evento": "IdleCowerEnter", "nombre": "Cower Enter", "categoria": "gestos"},
      {"evento": "IdleCowerEnterInstant", "nombre": "Cower Enter Instant", "categoria": "gestos"},
      {"evento": "idleFreaReactionStart", "nombre": "DLC2 Frea Disbelief Start", "categoria": "gestos"},
      {"evento": "idleFreaDisbeliefLoopStop", "nombre": "DLC2 Frea Reaction Stop", "categoria": "gestos"},
      {"evento": "idleFreaSorrowLoopEnter", "nombre": "DLC2 Frea Sorrow Enter", "categoria": "gestos"},
      {"evento": "IdleFreaSorrowLoopEnterInstant", "nombre": "DLC2 Frea Sorrow Enter Instant", "categoria": "gestos"},
      {"evento": "idleFreaSorrowExit", "nombre": "DLC2 Frea Sorrow Exit", "categoria": "gestos"},
      {"evento": "IdleFreaReaction2Start", "nombre": "DLC2 Idle Frea Disbelief2 Start", "categoria": "gestos"},
      {"evento": "IdleFreaDisbelief2LoopStop", "nombre": "DLC2 Idle Frea Disbelief2 Stop", "categoria": "gestos"},
      {"evento": "idleDisbelief01Start", "nombre": "DLC2 Storn Reaction1 Start", "categoria": "gestos"},
      {"evento": "idleDisbelief01Exit", "nombre": "DLC2 Storn Reaction1 Stop", "categoria": "gestos"},
      {"evento": "idleDisbelief02Start", "nombre": "DLC2 Storn Reaction2 Start", "categoria": "gestos"},
      {"evento": "idleDisbelief02Exit", "nombre": "DLC2 Storn Reaction2 Stop", "categoria": "gestos"},
      {"evento": "IdleGetAttention", "nombre": "Get Attention", "categoria": "gestos"},
      {"evento": "IdleHandsBehindBack", "nombre": "Hands Behind Back", "categoria": "gestos", "destacada": true},
      {"evento": "IdleHDRight", "nombre": "HD Right", "categoria": "gestos"},
      {"evento": "IdleHHRight", "nombre": "HH Right", "categoria": "gestos"},
      {"evento": "IdleKneelingEnter", "nombre": "Kneeling Enter", "categoria": "gestos", "destacada": true},
      {"evento": "IdleKneelingEnterInstant", "nombre": "Kneeling Enter Instant", "categoria": "gestos"},
      {"evento": "IdleLaugh", "nombre": "Laugh", "categoria": "gestos", "destacada": true},
      {"evento": "IdleLookFar", "nombre": "Look Far", "categoria": "gestos"},
      {"evento": "IdleSilentBow", "nombre": "MQ Phantom Unsummon", "categoria": "gestos"},
      {"evento": "IdleMT_DoorBang", "nombre": "MT Door Bang", "categoria": "gestos"},
      {"evento": "IdleNervous", "nombre": "Nervous", "categoria": "gestos", "destacada": true},
      {"evento": "OffsetArmsCrossedStart", "nombre": "Offset Arms Crossed Start", "categoria": "gestos", "destacada": true},
      {"evento": "IdlePlayer", "nombre": "Player Stop", "categoria": "gestos"},
      {"evento": "IdlePointClose", "nombre": "Point Close", "categoria": "gestos"},
      {"evento": "IdlePointFar_01", "nombre": "Point Far 01", "categoria": "gestos", "destacada": true},
      {"evento": "IdlePointFar_02", "nombre": "Point Far 02", "categoria": "gestos"},
      {"evento": "IdlePresentSkeletonKey", "nombre": "Present Skeleton Key", "categoria": "gestos"},
      {"evento": "IdleSalute", "nombre": "Salute", "categoria": "gestos", "destacada": true},
      {"evento": "IdleSnapToAttention", "nombre": "Snap To Attention", "categoria": "gestos", "destacada": true},
      {"evento": "IdleStaticPoseAStart", "nombre": "Static Pose A", "categoria": "gestos"},
      {"evento": "IdleStaticPoseBStart", "nombre": "Static Pose B", "categoria": "gestos"},
      {"evento": "IdleStaticPoseCStart", "nombre": "Static Pose C", "categoria": "gestos"},
      {"evento": "IdleSurrender", "nombre": "Surrender", "categoria": "gestos", "destacada": true},
      {"evento": "IdleTalkAndUseItem", "nombre": "Talking With Item", "categoria": "gestos"},
      {"evento": "IdleValericaWalkForward", "nombre": "Valerica Walk Forward", "categoria": "gestos"},
      {"evento": "IdleWalkingCameraEnd", "nombre": "Walking Camera End", "categoria": "gestos"},
      {"evento": "IdleWalkingCameraStart", "nombre": "Walking Camera Start", "categoria": "gestos"},
      {"evento": "IdleWave", "nombre": "Wave", "categoria": "gestos", "destacada": true},
      {"evento": "IdleWipeBrow", "nombre": "Wipe Brow", "categoria": "gestos"},
      {"evento": "IdleBoundKneesEnterInstant", "nombre": "Bound Knees Enter Instant", "categoria": "herido"},
      {"evento": "BoundStandingCut", "nombre": "Bound Standing Cut", "categoria": "herido"},
      {"evento": "BoundStandingCutNPC", "nombre": "Bound Standing Cut NPC", "categoria": "herido"},
      {"evento": "IdleBracedPain", "nombre": "Braced Pain", "categoria": "herido"},
      {"evento": "IdleCartExitInstant", "nombre": "Cart Exit Instant", "categoria": "herido"},
      {"evento": "IdleCartPrisonerAExit", "nombre": "Cart Prisoner A Exit", "categoria": "herido"},
      {"evento": "IdleCartPrisonerAIdle", "nombre": "Cart Prisoner A Idle", "categoria": "herido"},
      {"evento": "IdleCartPrisonerASway", "nombre": "Cart Prisoner A Sway", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBExit", "nombre": "Cart Prisoner B Exit", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBIdle", "nombre": "Cart Prisoner B Idle", "categoria": "herido"},
      {"evento": "IdleCartPrisonerBSway", "nombre": "Cart Prisoner B Sway", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCExit", "nombre": "Cart Prisoner C Exit", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCIdle", "nombre": "Cart Prisoner C Idle", "categoria": "herido"},
      {"evento": "IdleCartPrisonerCSway", "nombre": "Cart Prisoner C Sway", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDExit", "nombre": "Cart Prisoner D Exit", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDIdle", "nombre": "Cart Prisoner D Idle", "categoria": "herido"},
      {"evento": "IdleCartPrisonerDSway", "nombre": "Cart Prisoner D Sway", "categoria": "herido"},
      {"evento": "DeathAnim", "nombre": "Death Animation Start", "categoria": "herido"},
      {"evento": "IdleDLC02FallOnKnees", "nombre": "DLC02 Fall On Knees", "categoria": "herido"},
      {"evento": "IdleDLC02MiraakDeathFinish", "nombre": "DLC02 Miraak Death Finish", "categoria": "herido"},
      {"evento": "IdleDLC02MiraakDeath", "nombre": "DLC02 Miraak Death Start", "categoria": "herido"},
      {"evento": "IdleExecutionGuardIdleEnterInstant", "nombre": "Esxecutioner Guard Enter Instant", "categoria": "herido"},
      {"evento": "IdleExecutionerAlduinReaction", "nombre": "Executioner Alduin Reaction", "categoria": "herido"},
      {"evento": "IdleExecutionerAlduinReactionDeath", "nombre": "Executioner Alduin Reaction Death", "categoria": "herido"},
      {"evento": "IdleExecutionerChop_Player", "nombre": "Executioner Chop Player", "categoria": "herido"},
      {"evento": "IdleExecutionGuardIdle", "nombre": "Executioner Guard Enter", "categoria": "herido"},
      {"evento": "IdleFurnitureExitTriggered", "nombre": "Executioner Guard Exit", "categoria": "herido"},
      {"evento": "IdleHandCut", "nombre": "Hand Cut", "categoria": "herido"},
      {"evento": "IdleExecutionerChop", "nombre": "Head Chop", "categoria": "herido"},
      {"evento": "IdleInjured", "nombre": "Injured", "categoria": "herido", "destacada": true},
      {"evento": "GetUpBegin", "nombre": "NPC Get Up", "categoria": "herido"},
      {"evento": "OffsetBoundStandingPlayerInstant", "nombre": "Offset Bound Standing Player Instant", "categoria": "herido"},
      {"evento": "OffsetBoundStandingStart", "nombre": "Offset Bound Standing Start", "categoria": "herido"},
      {"evento": "IdlePrisonerBeat", "nombre": "Prisoner Beat", "categoria": "herido"},
      {"evento": "IdleSoupDeath", "nombre": "Soup Death", "categoria": "herido"},
      {"evento": "TG05_GetUp", "nombre": "TG05 Get Up", "categoria": "herido"},
      {"evento": "TG05_KnockOut", "nombre": "TG05 Knock Out", "categoria": "herido"},
      {"evento": "TG05_StabPlayer", "nombre": "TG05 Stab Player", "categoria": "herido"},
      {"evento": "IdleUncontrollableCough", "nombre": "Uncontrollable Cough", "categoria": "herido"},
      {"evento": "IdleWounded_01", "nombre": "Wounded 01", "categoria": "herido", "destacada": true},
      {"evento": "IdleWounded_02", "nombre": "Wounded 02", "categoria": "herido"},
      {"evento": "IdleWounded_03", "nombre": "Wounded 03", "categoria": "herido"},
      {"evento": "IdleBook_ReadTG06", "nombre": "Book Read TG06", "categoria": "leer"},
      {"evento": "IdleBook_Read", "nombre": "Book Reading", "categoria": "leer", "destacada": true},
      {"evento": "IdleBook_PageTurn", "nombre": "Book Turn Many Pages", "categoria": "leer"},
      {"evento": "IdleBook_OnePage", "nombre": "Book Turn One Page", "categoria": "leer"},
      {"evento": "IdleMQ203EsbernBookEnter", "nombre": "MQ203 Esbern Book Enter", "categoria": "leer"},
      {"evento": "IdleMQ203EsbernBookEnterInstant", "nombre": "MQ203 Esbern Book Enter Instant", "categoria": "leer"},
      {"evento": "IdleNoteRead", "nombre": "Note Read", "categoria": "leer", "destacada": true},
      {"evento": "IdleRFPickUpScroll", "nombre": "RF Pick Up Scroll", "categoria": "leer"},
      {"evento": "IdleStudy", "nombre": "Study", "categoria": "leer", "destacada": true},
      {"evento": "IdleTG06FlipPage", "nombre": "TG06 Flip Page", "categoria": "leer"},
      {"evento": "IdleTG06TranslationEnter", "nombre": "TG06 Translate Enter", "categoria": "leer"},
      {"evento": "IdleTG06TranslationEnterInstant", "nombre": "TG06 Translate Enter Instant", "categoria": "leer"},
      {"evento": "IdleBlessingKneelEnter", "nombre": "Blessing Kneel Enter", "categoria": "magia", "destacada": true},
      {"evento": "IdleBlessingKneelEnterInstant", "nombre": "Blessing Kneel Enter Instant", "categoria": "magia"},
      {"evento": "IdleBloodPortalActivate", "nombre": "Blood Portal Activate", "categoria": "magia"},
      {"evento": "IdleBoyRitual", "nombre": "Boy Ritual", "categoria": "magia"},
      {"evento": "IdleCannibalFeedCrouching", "nombre": "Cannibal Feed Crouching", "categoria": "magia"},
      {"evento": "IdleCannibalFeedStanding", "nombre": "Cannibal Feed Standing", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony1Welcome", "nombre": "CO2 Ceremony1 Welcome", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony2Blessing", "nombre": "CO2 Ceremony2 Blessing", "categoria": "magia"},
      {"evento": "IdleCO2Ceremony3Chest", "nombre": "CO2 Ceremony3 Chest", "categoria": "magia"},
      {"evento": "IdlePrayCrouchedEnter", "nombre": "Crouched Pray Enter", "categoria": "magia"},
      {"evento": "IdlePrayCrouchedEnterInstant", "nombre": "Crouched Pray Enter Instant", "categoria": "magia"},
      {"evento": "IdleDA02BoethiahPostEnter", "nombre": "DA02 Boethiah Post Enter", "categoria": "magia"},
      {"evento": "IdleDA02BoethiahPostEnterInstant", "nombre": "DA02 Boethiah Post Enter Instant", "categoria": "magia"},
      {"evento": "IdleDLC02TentacleWordBurnBegin", "nombre": "DLC02 Tentacle Word Burn Begin", "categoria": "magia"},
      {"evento": "IdleDLC02TentacleWordBurnEnd", "nombre": "DLC02 Tentacle Word Burn End", "categoria": "magia"},
      {"evento": "IdleDLC1BossExplosion1stP", "nombre": "DLC1 Boss Explosion1st P", "categoria": "magia"},
      {"evento": "IdleReadElderScroll3rdP", "nombre": "DLC1 Read Elder Scroll3rd P Enter", "categoria": "magia"},
      {"evento": "IdleReadElderScrollEnd", "nombre": "DLC1 Read Elder Scroll3rd P Exit", "categoria": "magia"},
      {"evento": "IdleDLC2TentacleWarpBook", "nombre": "DLC2 Tentacle Warp Book", "categoria": "magia"},
      {"evento": "IdleGreybeardMeditateEnter", "nombre": "Greybeard Meditate Enter", "categoria": "magia"},
      {"evento": "IdleGreybeardMeditateEnterInstant", "nombre": "Greybeard Meditate Enter Instant", "categoria": "magia"},
      {"evento": "IdleGreybeardWordTeach", "nombre": "Greybeard Word Teach", "categoria": "magia"},
      {"evento": "IdleMagic_01", "nombre": "Magic 01", "categoria": "magia"},
      {"evento": "IdleMesmerize", "nombre": "Mesmerize", "categoria": "magia"},
      {"evento": "IdleMesmerizeStop", "nombre": "Mesmerize Stop", "categoria": "magia"},
      {"evento": "IdleMQ206FelldirRitualEnter", "nombre": "MQ206 Felldir Ritual Enter", "categoria": "magia"},
      {"evento": "IdleMQ206FelldirRitualEnterInstant", "nombre": "MQ206 Felldir Ritual Enter Instant", "categoria": "magia"},
      {"evento": "IdleMQ206FelldirShowScroll", "nombre": "MQ206 Felldir Show Scroll", "categoria": "magia"},
      {"evento": "IdleNocturnalEnter", "nombre": "Nocturnal Enter DUPLICATE000", "categoria": "magia"},
      {"evento": "IdleNocturnal_Exit", "nombre": "Nocturnal Exit", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleA", "nombre": "Nocturnal Idle A", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleAMirror", "nombre": "Nocturnal Idle A Mirror", "categoria": "magia"},
      {"evento": "IdleNocturnal_IdleB", "nombre": "Nocturnal Idle B", "categoria": "magia"},
      {"evento": "IdleNocturnal_LookLeft", "nombre": "Nocturnal Look Left", "categoria": "magia"},
      {"evento": "IdleNocturnal_LookRight", "nombre": "Nocturnal Look Right", "categoria": "magia"},
      {"evento": "IdleNocturnal_Rise", "nombre": "Nocturnal Rise", "categoria": "magia"},
      {"evento": "IdlePray", "nombre": "Pray", "categoria": "magia", "destacada": true},
      {"evento": "IdleReadElderScroll", "nombre": "Read Elder Scroll", "categoria": "magia"},
      {"evento": "IdleReadElderScrollLonger", "nombre": "Read Elder Scroll Longer", "categoria": "magia"},
      {"evento": "IdleRitualSkull1", "nombre": "Ritual Skull1", "categoria": "magia"},
      {"evento": "IdleRitualSkull2", "nombre": "Ritual Skull2", "categoria": "magia"},
      {"evento": "IdleRitualSkull3", "nombre": "Ritual Skull3", "categoria": "magia"},
      {"evento": "IdleRitualStart", "nombre": "Ritual Start", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceAscensionBurning", "nombre": "Snow Elf Prince Ascension", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceBigSpell", "nombre": "Snow Elf Prince Big Spell", "categoria": "magia"},
      {"evento": "IdleSnowElfPrinceBigSpellRelease", "nombre": "Snow Elf Prince Big Spell Release", "categoria": "magia"},
      {"evento": "IdleT02AscendFemale", "nombre": "T02 Ascend Female", "categoria": "magia"},
      {"evento": "IdleT02AscendMale", "nombre": "T02 Ascend Male", "categoria": "magia"},
      {"evento": "IdleTelvanniTowerFloatDown", "nombre": "Telvanni Tower Float Down Enter", "categoria": "magia"},
      {"evento": "IdleTelvanniTowerFloatUp", "nombre": "Telvanni Tower Float Up Enter", "categoria": "magia"},
      {"evento": "IdleVampireFeastVictim", "nombre": "Vampire Feast Victim Enter", "categoria": "magia"},
      {"evento": "IdleVampireLordTransformation", "nombre": "Vampire Lord Transformation", "categoria": "magia"},
      {"evento": "IdleWalkThroughWallEnter", "nombre": "Walk Through Wall Enter", "categoria": "magia"},
      {"evento": "IdleWalkThroughWallEnterInstant", "nombre": "Walk Through Wall Enter Instant", "categoria": "magia"},
      {"evento": "IdleWerewolfTransformation", "nombre": "Werewolf Transformation", "categoria": "magia"},
      {"evento": "IdleApplaudSarcastic", "nombre": "Applaud Sarcastic", "categoria": "musica"},
      {"evento": "IdleApplaud2", "nombre": "Applaud2", "categoria": "musica", "destacada": true},
      {"evento": "IdleApplaud3", "nombre": "Applaud3", "categoria": "musica"},
      {"evento": "IdleApplaud4", "nombre": "Applaud4", "categoria": "musica"},
      {"evento": "IdleApplaud5", "nombre": "Applaud5", "categoria": "musica"},
      {"evento": "IdleBlowHornImperial", "nombre": "Blow Horn Imperial", "categoria": "musica"},
      {"evento": "IdleBlowHornStormcloak", "nombre": "Blow Horn Stormcloak", "categoria": "musica"},
      {"evento": "IdleCiceroAgitated", "nombre": "Cicero Agitated", "categoria": "musica"},
      {"evento": "IdleCiceroDance1", "nombre": "Cicero Dance1", "categoria": "musica", "destacada": true},
      {"evento": "IdleCiceroDance2", "nombre": "Cicero Dance2", "categoria": "musica"},
      {"evento": "IdleCiceroDance3", "nombre": "Cicero Dance3", "categoria": "musica"},
      {"evento": "IdleCiceroHappy", "nombre": "Cicero Happy", "categoria": "musica"},
      {"evento": "IdleCivilWarCheer", "nombre": "Civil War Cheer", "categoria": "musica"},
      {"evento": "IdleDrumStart", "nombre": "Drum Start", "categoria": "musica", "destacada": true},
      {"evento": "IdleFluteStart", "nombre": "Flute Start", "categoria": "musica", "destacada": true},
      {"evento": "IdleLuteStart", "nombre": "Lute Start", "categoria": "musica", "destacada": true},
      {"evento": "SpectatorCheer", "nombre": "Spectator Cheer", "categoria": "musica"},
      {"evento": "SpectatorClap", "nombre": "Spectator Clap", "categoria": "musica"},
      {"evento": "SpectatorGawk", "nombre": "Spectator Gawk", "categoria": "musica"},
      {"evento": "SpectatorTalking", "nombre": "Spectator Talk Fail Safe", "categoria": "musica"},
      {"evento": "IdleActivatePickUp", "nombre": "Activate Pick Up", "categoria": "oficios"},
      {"evento": "IdleBlackSmithingEnterStart", "nombre": "Black Smithing Enter", "categoria": "oficios", "destacada": true},
      {"evento": "IdleBlackSmithEnterInstant", "nombre": "Black Smithing Instant", "categoria": "oficios"},
      {"evento": "IdleCartDriverExit", "nombre": "Cart Driver Exit", "categoria": "oficios"},
      {"evento": "IdleCartDriverIdle", "nombre": "Cart Driver Idle", "categoria": "oficios"},
      {"evento": "IdleCartDriverSway", "nombre": "Cart Driver Sway", "categoria": "oficios"},
      {"evento": "IdleCartTravelDriverEnter", "nombre": "Cart Travel Driver Enter", "categoria": "oficios"},
      {"evento": "IdleCartTravelDriverEnterInstant", "nombre": "Cart Travel Driver Enter Instant", "categoria": "oficios"},
      {"evento": "IdleCartTravelPlayerEnter", "nombre": "Cart Travel Player Enter", "categoria": "oficios"},
      {"evento": "IdleCartTravelPlayerEnterInstant", "nombre": "Cart Travel Player Enter Instant", "categoria": "oficios"},
      {"evento": "IdleChiselKneelingEnter", "nombre": "Chisel Kneeling Enter", "categoria": "oficios"},
      {"evento": "IdleChiselKneelingEnterInstant", "nombre": "Chisel Kneeling Enter Instant", "categoria": "oficios"},
      {"evento": "IdleChiselStandingEnter", "nombre": "Chisel Standing Enter", "categoria": "oficios"},
      {"evento": "IdleChiselStandingEnterInstant", "nombre": "Chisel Standing Enter Instant", "categoria": "oficios"},
      {"evento": "IdleDwemerExtractorEnter", "nombre": "Dwemer Extractor", "categoria": "oficios"},
      {"evento": "IdleExamine", "nombre": "Examine", "categoria": "oficios"},
      {"evento": "IdleFeedChicken", "nombre": "Feed Chickens", "categoria": "oficios"},
      {"evento": "IdleGive", "nombre": "Give", "categoria": "oficios"},
      {"evento": "IdleGiveMQ105Horn", "nombre": "Give MQ105 Horn", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerChargenEnter", "nombre": "Hadvar Write Ledger Enter", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerEnterInstant", "nombre": "Hadvar Write Ledger Enter Instant", "categoria": "oficios"},
      {"evento": "IdleHoe", "nombre": "Hoe", "categoria": "oficios", "destacada": true},
      {"evento": "IdleLightSconce", "nombre": "Light Sconce", "categoria": "oficios"},
      {"evento": "IdleLockPick", "nombre": "Lock Pick", "categoria": "oficios"},
      {"evento": "idleLooseSweepingStart", "nombre": "Loose Sweeping Start", "categoria": "oficios", "destacada": true},
      {"evento": "OffsetCarryBasketStart", "nombre": "Offset Carry Basket Start", "categoria": "oficios"},
      {"evento": "OffsetCarryFlowerBasketPickStart", "nombre": "Offset Carry Flower Basket Pick Start", "categoria": "oficios"},
      {"evento": "IdleOffsetCarryPotServe", "nombre": "Offset Carry Pot Serve", "categoria": "oficios"},
      {"evento": "OffsetCarryPotStart", "nombre": "Offset Carry Pot Start", "categoria": "oficios"},
      {"evento": "OffsetFlowerBasketStart", "nombre": "Offset Flower Basket Start", "categoria": "oficios"},
      {"evento": "IdlePickaxeEnter", "nombre": "Pickaxe Enter", "categoria": "oficios", "destacada": true},
      {"evento": "IdlePickaxeEnterInstant", "nombre": "Pickaxe Enter Instant", "categoria": "oficios"},
      {"evento": "IdlePickup_Ground", "nombre": "Pickup Ground", "categoria": "oficios"},
      {"evento": "IdlePullChain", "nombre": "Pull Chain Enter", "categoria": "oficios"},
      {"evento": "IdleSearchChestEnter", "nombre": "Search Chest Enter", "categoria": "oficios"},
      {"evento": "IdleSearchChestEnterInstant", "nombre": "Search Chest Enter Instant", "categoria": "oficios"},
      {"evento": "IdleSearchTableEnter", "nombre": "Search Table Enter", "categoria": "oficios"},
      {"evento": "IdleSearchTableEnterInstant", "nombre": "Search Table Enter Instant", "categoria": "oficios"},
      {"evento": "IdleSearchingChest", "nombre": "Searching Chest", "categoria": "oficios"},
      {"evento": "IdleSearchingTable", "nombre": "Searching Table", "categoria": "oficios"},
      {"evento": "IdleSell", "nombre": "Sell", "categoria": "oficios"},
      {"evento": "IdleSharpeningWheelEnterInstant", "nombre": "Sharpening Wheel Enter Instant", "categoria": "oficios"},
      {"evento": "IdleSharpeningWheelStart", "nombre": "Sharpening Wheel Start", "categoria": "oficios"},
      {"evento": "IdleStonePickUpEnterInstant", "nombre": "Stone Pick Up Enter Instant", "categoria": "oficios"},
      {"evento": "IdleStonePickUpEnter", "nombre": "Stone Pick Up Exit", "categoria": "oficios"},
      {"evento": "IdleStonePutDownEnter", "nombre": "Stone Put Down Enter", "categoria": "oficios"},
      {"evento": "IdleTake", "nombre": "Take", "categoria": "oficios"},
      {"evento": "IdleWayShrineWaterScoopEnter", "nombre": "Way Shrine Water Scoop", "categoria": "oficios"},
      {"evento": "IdleWoodChopEnterInstant", "nombre": "Wood Chop Enter Instant", "categoria": "oficios"},
      {"evento": "IdleWoodChopStart", "nombre": "Wood Chop Start", "categoria": "oficios", "destacada": true},
      {"evento": "IdleWoodPickUpEnter", "nombre": "Wood Pick Up Enter", "categoria": "oficios"},
      {"evento": "IdlewoodputdownEnter", "nombre": "woodputdown Enter", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerEnter", "nombre": "Write Ledger Enter", "categoria": "oficios"},
      {"evento": "IdleWriteLedgerWrite", "nombre": "Write Ledger Write", "categoria": "oficios"},
      {"evento": "IdleWriteTableStandingEnter", "nombre": "Write Table Standing Enter", "categoria": "oficios"},
      {"evento": "IdleWriteTableStandingEnterInstant", "nombre": "Write Table Standing Enter Instant", "categoria": "oficios"},
      {"evento": "IdleCraftingCookingPotAddIngredient", "nombre": "Crafting Cooking Pot Add Ingredient", "categoria": "otras"},
      {"evento": "IdleCraftingCookingPotTalkA", "nombre": "Crafting Cooking Pot Talk A", "categoria": "otras"},
      {"evento": "IdleCraftingCookingPotTalkB", "nombre": "Crafting Cooking Pot Talk B", "categoria": "otras"},
      {"evento": "IdleDLC02BoatRide", "nombre": "DLC02 Boat Ride", "categoria": "otras"},
      {"evento": "IdleTGFalmerStatueEnter", "nombre": "TG Falmer Statue Enter", "categoria": "otras"},
      {"evento": "IdleTGStatueEnterInstant", "nombre": "TG Falmer Statue Enter Instant", "categoria": "otras"},
      {"evento": "IdleTG08_Phase1", "nombre": "TG08 Ceremony Enter", "categoria": "otras"},
      {"evento": "IdleTG08_Phase1_EnterInstant", "nombre": "TG08 Ceremony Enter Instant", "categoria": "otras"},
      {"evento": "IdleTG08_Phase2", "nombre": "TG08 Phase2", "categoria": "otras"},
      {"evento": "IdleTG08_Phase3", "nombre": "TG08 Phase3", "categoria": "otras"},
      {"evento": "IdleTG08_Phase4", "nombre": "TG08 Phase4", "categoria": "otras"},
      {"evento": "IdleTG08_Phase5", "nombre": "TG08 Phase5", "categoria": "otras"},
      {"evento": "WardBreak", "nombre": "Ward Broken", "categoria": "otras"},
      {"evento": "IdleAltarEnterInstant", "nombre": "Altar Enter Instant Left", "categoria": "sentarse"},
      {"evento": "IdleAltarEnter", "nombre": "Altar Enter Left", "categoria": "sentarse"},
      {"evento": "IdleBarCounterEnter", "nombre": "Bar Counter Enter", "categoria": "sentarse"},
      {"evento": "IdleBarCounterEnterInstant", "nombre": "Bar Counter Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleBarCounterWipe", "nombre": "Bar Counter Wipe", "categoria": "sentarse"},
      {"evento": "ChairReadingStart", "nombre": "Book Sitting Reading", "categoria": "sentarse"},
      {"evento": "ChairReadingIdles", "nombre": "Book Sitting Turn Many Pages", "categoria": "sentarse"},
      {"evento": "ChairDrinkingStart", "nombre": "Chair Drinking Start", "categoria": "sentarse"},
      {"evento": "ChairEatingSoupStart", "nombre": "Chair Eating Soup Start", "categoria": "sentarse"},
      {"evento": "ChairEatingStart", "nombre": "Chair Eating Start", "categoria": "sentarse"},
      {"evento": "ChairEatingStart_VampireMeat", "nombre": "Chair Eating Vampire Meat", "categoria": "sentarse"},
      {"evento": "IdleChairWrite", "nombre": "Chair Write", "categoria": "sentarse"},
      {"evento": "IdleCounterEnterInstant", "nombre": "Counter Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleCounterStart", "nombre": "Counter Start", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDFrontEnter", "nombre": "Enter Chair CHILD Front", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDEnterInstant", "nombre": "Enter Chair CHILD Instant", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDLeftEnter", "nombre": "Enter Chair CHILD Left", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDRightEnter", "nombre": "Enter Chair CHILD Right", "categoria": "sentarse"},
      {"evento": "IdleChairFrontEnter", "nombre": "Enter Chair Front", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleChairEnterInstant", "nombre": "Enter Chair Instant", "categoria": "sentarse"},
      {"evento": "IdleChairLeftEnter", "nombre": "Enter Chair Left", "categoria": "sentarse"},
      {"evento": "IdleChairRightEnter", "nombre": "Enter Chair Right", "categoria": "sentarse"},
      {"evento": "IdleWallLeanStart", "nombre": "Enter Wall Lean", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleTableBackExit", "nombre": "Exit Chair Back Quick", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDFrontExit", "nombre": "Exit Chair CHILD Front", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDLeftExit", "nombre": "Exit Chair CHILD Left", "categoria": "sentarse"},
      {"evento": "IdleChairCHILDRightExit", "nombre": "Exit Chair CHILD Right", "categoria": "sentarse"},
      {"evento": "IdleChairFrontExit", "nombre": "Exit Chair Front", "categoria": "sentarse"},
      {"evento": "IdleChairFrontQuickExit", "nombre": "Exit Chair Front Quick", "categoria": "sentarse"},
      {"evento": "idleChairLeftExit", "nombre": "Exit Chair Left", "categoria": "sentarse"},
      {"evento": "IdleChairLeftQuickExit", "nombre": "Exit Chair Left Quick", "categoria": "sentarse"},
      {"evento": "idleChairRightExit", "nombre": "Exit Chair Right", "categoria": "sentarse"},
      {"evento": "IdleChairRightQuickExit", "nombre": "Exit Chair Right Quick", "categoria": "sentarse"},
      {"evento": "IdleChairExitStart", "nombre": "Hadvar Write Ledger Exit", "categoria": "sentarse"},
      {"evento": "IdleHideREnter", "nombre": "Hide R Enter", "categoria": "sentarse"},
      {"evento": "IdleHideREnterInstant", "nombre": "Hide R Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleJarlChairEnter", "nombre": "Jarl Chair Enter", "categoria": "sentarse"},
      {"evento": "IdleJarlChairEnterInstant", "nombre": "Jarl Chair Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleRailLeanEnter", "nombre": "Rail Lean Enter", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleRailLeanEnterInstant", "nombre": "Rail Lean Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleRailLeanExit", "nombre": "Rail Lean Exit", "categoria": "sentarse"},
      {"evento": "IdleLounge", "nombre": "Shelf Enter Instant", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleLounge_Exit", "nombre": "Shelf Exit", "categoria": "sentarse"},
      {"evento": "idleChairArmsCrossedVar1", "nombre": "Sitting Chair Arms Crossed Var1", "categoria": "sentarse"},
      {"evento": "idleChairArmsCrossedVar2", "nombre": "Sitting Chair Arms Crossed Var2", "categoria": "sentarse"},
      {"evento": "idleChairLookDown", "nombre": "Sitting Chair Look Down", "categoria": "sentarse"},
      {"evento": "idleChairShoulderFlex", "nombre": "Sitting Chair Shoulder Flex", "categoria": "sentarse"},
      {"evento": "IdleChairVar1", "nombre": "Sitting Chair Var1", "categoria": "sentarse"},
      {"evento": "idleChairVar2", "nombre": "Sitting Chair Var2", "categoria": "sentarse"},
      {"evento": "IdleSnowElfPrinceFireAndForget", "nombre": "Snow Elf Prince Chair Fire And Forget", "categoria": "sentarse"},
      {"evento": "IdleSnowElfPrinceChairDialogue", "nombre": "Snow Elf Prince Dialogue", "categoria": "sentarse"},
      {"evento": "IdleWallSoldierEnter", "nombre": "Soldier Wall Enter", "categoria": "sentarse"},
      {"evento": "IdleWallSoldierEnterInstant", "nombre": "Soldier Wall Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleStoolEnter", "nombre": "Stool Enter", "categoria": "sentarse", "destacada": true},
      {"evento": "IdleStoolEnterInstant", "nombre": "Stool Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleStoolBackExit", "nombre": "Stool Exit", "categoria": "sentarse"},
      {"evento": "IdleTableDrinkAndMugEnter", "nombre": "Table Drink And Mug Enter Loose", "categoria": "sentarse"},
      {"evento": "IdleTableDrinkEnter", "nombre": "Table Drink Enter Loose", "categoria": "sentarse"},
      {"evento": "IdleTableLeanPoint", "nombre": "Table Lean Point", "categoria": "sentarse"},
      {"evento": "IdleTableMugEnter", "nombre": "Table Mug Enter Loose", "categoria": "sentarse"},
      {"evento": "IdleTablePassOutEnter", "nombre": "Table Pass Out Enter Loose", "categoria": "sentarse"},
      {"evento": "ChairVampireEatingStart", "nombre": "Vampire Chair Drinking", "categoria": "sentarse"},
      {"evento": "IdleWallCornerPeekLEnter", "nombre": "Wall Corner Peek L Enter", "categoria": "sentarse"},
      {"evento": "IdleWallCornerPeekLEnterInstant", "nombre": "Wall Corner Peek L Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleWallCornerPeekREnter", "nombre": "Wall Corner Peek R Enter", "categoria": "sentarse"},
      {"evento": "IdleWallCornerPeekREnterInstant", "nombre": "Wall Corner Peek R Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleWallLeanEnterInstant", "nombre": "Wall Lean Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleWriteTableChairEnterInstant", "nombre": "Write Table Chair Enter Instant", "categoria": "sentarse"},
      {"evento": "IdleWriteTableChairLeftEnter", "nombre": "Write Table Chair Enter Left", "categoria": "sentarse"},
      {"evento": "IdleWriteTableChairRightEnter", "nombre": "Write Table Chair Enter Right", "categoria": "sentarse"},
      {"evento": "IdleWriteTableChairLeftExit", "nombre": "Write Table Chair Exit Left", "categoria": "sentarse"},
      {"evento": "IdleWriteTableChairRightExit", "nombre": "Write Table Chair Exit Right", "categoria": "sentarse"}
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

      // En primera persona las poses no se ven: el cuerpo no se dibuja.
      if (TERCERA_PERSONA) Reproductor.aTerceraPersona();

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
    return llevar(limpia);
  }

  function pedirParar(origen) {
    Bucle.quitar();          // parar es parar: si habia bucle, se acaba
    return Reproductor.parar({ quien: FORMID_JUGADOR, origen: origen || 'desconocido' });
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

  function panelEnLaPagina(datos, comoSaleLaPestana) {
    // Si ya estaba puesto, solo se le pasan los datos nuevos y no se duplica.
    if (window.__animplayer) {
      window.__animplayer.cargar(datos);
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

      /* La pestana de arriba. Siempre visible, pegada al borde superior. */
      '#' + ID + ' .ap-tirador{pointer-events:auto;display:flex;align-items:center;',
      '  gap:8px;margin-left:auto;width:max-content;padding:7px 14px 8px;cursor:pointer;',
      '  background:linear-gradient(180deg,rgba(42,33,24,.97),rgba(20,16,12,.97));',
      '  border:2px solid #6b5a3a;border-top:none;border-radius:0 0 4px 4px;',
      '  box-shadow:0 4px 14px rgba(0,0,0,.55);',
      '  font-family:"Bankir-Retro",serif;letter-spacing:2px;text-transform:uppercase;',
      '  color:#e8c987;text-shadow:0 1px 2px rgba(0,0,0,.8)}',
      '#' + ID + ' .ap-tirador:hover{border-color:#c9a35a}',
      /* Mientras el navegador no tiene el foco, el raton no llega a la pagina:
         la pestana no se podria pulsar y seria un adorno tapando el juego. Asi
         que por defecto solo aparece cuando se puede usar. */
      '#' + ID + '.ap-sinraton .ap-tirador{display:none}',
      '#' + ID + ' .ap-flecha{font-size:10px;color:#c9a35a;transition:transform .15s}',
      '#' + ID + '.ap-abierto .ap-flecha{transform:rotate(180deg)}',

      /* El panel que se descuelga. */
      '#' + ID + ' .ap-panel{pointer-events:auto;position:relative;width:360px;',
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
      '#' + ID + ' .ap-titulo{flex:1;font-family:"Bankir-Retro",serif;font-size:15px;',
      '  letter-spacing:2px;text-transform:uppercase;color:#e8c987;',
      '  text-shadow:0 1px 2px rgba(0,0,0,.8)}',
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
      '#' + ID + ' .ap-evento{font-size:10px;color:#8a7f68;max-width:44%;',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
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
      '<div class="ap-tirador"><span class="ap-rotulo">Animaciones</span>' +
      '<span class="ap-flecha">&#9660;</span></div>' +
      '<div class="ap-panel">' +
      '  <div class="ap-cabecera"><div class="ap-titulo">Recomendadas</div>' +
      '    <div class="ap-cerrar" title="Cerrar">&#10005;</div></div>' +
      '  <input class="ap-buscar" type="text" spellcheck="false"' +
      '         placeholder="Buscar: sentarse, laud, rezar...">' +
      '  <div class="ap-categorias"></div>' +
      '  <div class="ap-lista"></div>' +
      '  <div class="ap-pie"><div class="ap-ahora">Nada en marcha</div>' +
      '    <div class="ap-bucle" title="Repetirla hasta que pulses Parar">' +
      '      <span class="ap-casilla"></span><span>En bucle</span></div>' +
      '    <div class="ap-boton ap-parar">Parar</div></div>' +
      '</div>';
    document.body.appendChild(raiz);

    var tirador = raiz.querySelector('.ap-tirador');
    var rotulo = raiz.querySelector('.ap-rotulo');
    var caja = raiz.querySelector('.ap-buscar');
    var chips = raiz.querySelector('.ap-categorias');
    var lista = raiz.querySelector('.ap-lista');
    var ahora = raiz.querySelector('.ap-ahora');
    var titulo = raiz.querySelector('.ap-titulo');
    var bucle = raiz.querySelector('.ap-bucle');

    /* ------------------------------------------------------------------ estado */
    var animaciones = [];
    var categorias = [];
    var categoria = '';        // '' es "todas"
    var elegida = 0;           // para moverse con las flechas
    var abierto = false;
    var enBucle = false;       // la casilla del pie
    var ultima = null;         // la ultima animacion pedida, para el bucle

    /** Prepara un texto para buscar sin acentos ni mayusculas. */
    function llano(t) {
      return String(t || '').toLowerCase()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
        .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n');
    }

    function cargar(d) {
      animaciones = (d && d.animaciones) || [];
      categorias = (d && d.categorias) || [];

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
      var soloRecomendadas = !texto && !categoria;
      var salida = [];

      for (var i = 0; i < animaciones.length; i++) {
        var a = animaciones[i];
        if (categoria && a.categoria !== categoria) continue;
        if (soloRecomendadas && !a.destacada) continue;
        var vale = true;
        for (var p = 0; p < partes.length; p++) {
          if (a._busca.indexOf(partes[p]) === -1) { vale = false; break; }
        }
        if (vale) salida.push(a);
      }
      return { lista: salida, soloRecomendadas: soloRecomendadas };
    }

    function pintarCategorias() {
      var html = ['<div class="ap-chip' + (categoria ? '' : ' ap-puesto') +
                  '" data-cat="">Recomendadas</div>'];
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
        titulo.textContent = 'Sin resultados';
        return;
      }

      var html = [];
      if (r.soloRecomendadas) {
        html.push('<div class="ap-grupo">Recomendadas &nbsp;·&nbsp; escribe o elige ' +
                  'una categoria para ver las ' + animaciones.length + '</div>');
      }
      var grupo = null;
      for (var i = 0; i < r.lista.length; i++) {
        var a = r.lista[i];
        if (!r.soloRecomendadas && !categoria && a.categoria !== grupo) {
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
          '<span class="ap-evento">' + escapar(a.evento) + '</span></div>');
      }
      lista.innerHTML = html.join('');
      titulo.textContent = caja.value.trim()
        ? r.lista.length + (r.lista.length === 1 ? ' resultado' : ' resultados')
        : (categoria ? nombreDe(categoria) : 'Recomendadas');
      var viva = lista.querySelector('.ap-elegida');
      if (viva && viva.scrollIntoView) viva.scrollIntoView({ block: 'nearest' });
    }

    function nombreDe(clave) {
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
    tirador.addEventListener('click', alternar);
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

    /* Cuando se ve la pestana.
       SkyMP avisa de que el navegador ha ganado o perdido el foco con estos dos
       sucesos, y son los mismos que manda el plugin al abrir y cerrar. Se
       escuchan en vez de inventarse otra senal: asi la pestana tambien aparece
       cuando el foco lo da otra cosa (F6, o el inventario del servidor). */
    function ajustarPestana(hayRaton) {
      if (comoSaleLaPestana === 'nunca') { raiz.classList.add('ap-sinraton'); return; }
      if (comoSaleLaPestana === 'siempre') { raiz.classList.remove('ap-sinraton'); return; }
      if (hayRaton || abierto) raiz.classList.remove('ap-sinraton');
      else raiz.classList.add('ap-sinraton');
    }
    window.addEventListener('skymp5-client:browserFocused', function () { ajustarPestana(true); });
    window.addEventListener('skymp5-client:browserUnfocused', function () { ajustarPestana(false); });
    ajustarPestana(document.hasFocus && document.hasFocus());

    /* Lo que el plugin puede pedirle al panel desde el juego. */
    window.__animplayer = {
      abrir: abrir,
      cerrar: cerrar,
      alternar: alternar,
      cargar: cargar,
      estaAbierto: function () { return abierto; },
      enBucle: function () { return enBucle; },
      pestana: ajustarPestana
    };

    cargar(datos);
    avisar('listo', { animaciones: animaciones.length });
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
        '(' + panelEnLaPagina.toString() + ')(' +
        JSON.stringify(catalogo) + ',' + JSON.stringify(PESTANA) + ');');
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

  function abrir(avisarAlPanel) {
    if (!puesto) inyectar();
    abierto = true;
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
    if (avisarAlPanel !== false) decirAlPanel('abrir');
  }

  function cerrar(avisarAlPanel) {
    abierto = false;
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
        // El panel se cerro solo (con la X o con Esc dentro de la pagina):
        // hay que devolver el foco y el movimiento al juego.
        if (abierto) encolar(function () { cerrar(false); });
        break;

      case 'animplayer:abierto':
        // El panel se abrio desde la pagina (pulsando su pestana). Hay que
        // hacer lo demas: quitarle el movimiento al personaje y apuntar que
        // esta abierto. No se le vuelve a decir al panel que se abra, que ya
        // lo esta; su abrir() no haria nada, pero pedirlo seria dar vueltas.
        if (!abierto) encolar(function () { abrir(false); });
        break;

      case 'animplayer:listo':
        apuntar('el panel responde con ' +
                ((mensaje.data && mensaje.data.animaciones) || 0) + ' animaciones');
        break;
    }
  });

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
