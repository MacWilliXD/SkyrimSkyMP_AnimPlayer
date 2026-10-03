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
  var RECORDAR_EL_ESTADO = opcion('recordarElEstado', true);
  var VOLVER_A_SENTARSE = opcion('volverASentarse', true);
  var ESPERA_AL_REPONER = opcion('esperaAlReponer', 333);
  var EVENTO_DE_PARADA = opcion('eventoDeParada', 'IdleStop');
  /* Cuanto dura la ventana para que un segundo Detener cuente como insistir y
     el corte vaya a por todas. Ver pedirParar. */
  var INSISTIR_EN = opcion('insistirEn', 3000);
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
      {"clave": "remates", "nombre": "Remates", "busqueda": "remate golpe de gracia ejecucion matar acabar"},
      {"clave": "montar", "nombre": "Montar", "busqueda": "caballo dragon montura cabalgar jinete"},
      {"clave": "combate", "nombre": "Combate", "busqueda": "pelear luchar atacar espada arco escudo grito"},
      {"clave": "moverse", "nombre": "Moverse", "busqueda": "saltar correr frenar nadar caer aterrizar andar"},
      {"clave": "sentarse", "nombre": "Sentarse y apoyarse", "busqueda": "sentarse silla taburete banco mesa barra apoyarse trono"},
      {"clave": "dormir", "nombre": "Dormir y tumbarse", "busqueda": "dormir cama tumbarse acostarse ataud desmayarse suelo"},
      {"clave": "oficios", "nombre": "Oficios y tareas", "busqueda": "trabajar herrero minar talar barrer granja escribir recoger"},
      {"clave": "comer", "nombre": "Comer y beber", "busqueda": "comer beber cenar hidromiel sopa brindar calentarse manos fuego"},
      {"clave": "musica", "nombre": "Música y fiesta", "busqueda": "musica bailar tocar laud flauta tambor aplaudir animar cuerno vitorear"},
      {"clave": "magia", "nombre": "Magia y rituales", "busqueda": "rezar orar ritual altar bendicion meditar pergamino transformarse"},
      {"clave": "leer", "nombre": "Leer y estudiar", "busqueda": "leer libro estudiar nota pergamino traducir pagina"},
      {"clave": "gestos", "nombre": "Gestos y expresión", "busqueda": "saludar senalar reir asentir rendirse burlarse gesto encogerse pose"},
      {"clave": "dialogo", "nombre": "Diálogo", "busqueda": "hablar conversar charlar discutir responder"},
      {"clave": "herido", "nombre": "Herido y cautiverio", "busqueda": "herido dolor morir sangrar toser levantarse atado ejecucion"},
      {"clave": "control", "nombre": "Control", "busqueda": "parar detener cancelar"},
      {"clave": "otras", "nombre": "Otras", "busqueda": ""}
    ],
    "animaciones": [
      {"evento": "SneakStart", "nombre": "Agacharse", "categoria": "combate", "descripcion": "Animación básica del jugador para agacharse (usada al usar el cntrl)", "visible": false, "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "MRh_SpellAimedStart", "nombre": "Apuntar con un hechizo, derecha", "categoria": "combate", "descripcion": "Incrementa el efecto del hechizo derecho", "visible": false},
      {"evento": "MLh_SpellAimedStart", "nombre": "Apuntar con un hechizo, izquierda", "categoria": "combate", "descripcion": "Incrementa el efecto del hechizo izquierdo", "visible": false},
      {"evento": "attackStart", "nombre": "Atacar", "categoria": "combate", "descripcion": "Ataca con el arma equipada (Mano derecha)", "visible": false},
      {"evento": "attackStartSprint", "nombre": "Atacar al correr a toda velocidad", "categoria": "combate", "descripcion": "Atacar al correr a toda velocidad. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackStartSprintLeftHand", "nombre": "Atacar al correr a toda velocidad con la izquierda", "categoria": "combate", "descripcion": "Atacar al correr a toda velocidad con la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStart_Sprint", "nombre": "Atacar con fuerza al correr a toda velocidad", "categoria": "combate", "descripcion": "Atacar con fuerza al correr a toda velocidad. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStart_2HMSprint", "nombre": "Atacar con fuerza al correr a toda velocidad a dos manos", "categoria": "combate", "descripcion": "Atacar con fuerza al correr a toda velocidad a dos manos. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStart_2HWSprint", "nombre": "Atacar con fuerza al correr a toda velocidad con arma pesada", "categoria": "combate", "descripcion": "Atacar con fuerza al correr a toda velocidad con arma pesada. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStart_SprintLeftHand", "nombre": "Atacar con fuerza al correr a toda velocidad con la izquierda", "categoria": "combate", "descripcion": "Atacar con fuerza al correr a toda velocidad con la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStartBackward", "nombre": "Atacar con fuerza hacia atrás", "categoria": "combate", "descripcion": "Atacar con fuerza hacia atrás. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStartForward", "nombre": "Atacar con fuerza hacia delante", "categoria": "combate", "descripcion": "Atacar con fuerza hacia delante. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStartForwardLeftHand", "nombre": "Atacar con fuerza hacia delante con la izquierda", "categoria": "combate", "descripcion": "Atacar con fuerza hacia delante con la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStartRight", "nombre": "Atacar con fuerza hacia la derecha", "categoria": "combate", "descripcion": "Atacar con fuerza hacia la derecha. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackPowerStartInPlace", "nombre": "Atacar con fuerza sin moverse", "categoria": "combate", "descripcion": "Atacar con fuerza sin moverse. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "attackStart_MC_1HMRight", "nombre": "Atacar con la derecha (una mano)", "categoria": "combate", "descripcion": "Ataca con el arma equipada (Una mano, mano derecha)", "visible": false},
      {"evento": "attackStartLeftHand", "nombre": "Atacar con la izquierda", "categoria": "combate", "descripcion": "Ataca con el arma equipada (Mano izquierda)", "visible": false},
      {"evento": "attackStart_MC_1HMLeft", "nombre": "Atacar con la izquierda (una mano)", "categoria": "combate", "descripcion": "Ataca con el arma equipada (Una mano, mano izquierda)", "visible": false},
      {"evento": "attackStartDualWield", "nombre": "Atacar con las dos armas", "categoria": "combate", "descripcion": "Ataca con el arma equipada (A dos manos)", "visible": false},
      {"evento": "attackPowerStartRightLeftHand", "nombre": "Ataque potente a la derecha, con la izquierda", "categoria": "combate", "descripcion": "Ataque potente con arma equipada (Una mano, izquierda)", "visible": false},
      {"evento": "attackPowerStartLeftLeftHand", "nombre": "Ataque potente a la izquierda, con la izquierda", "categoria": "combate", "descripcion": "Ataque potente con arma equipada (Una mano, derecha)", "visible": false},
      {"evento": "attackPowerStart_MC_1HMRight", "nombre": "Ataque potente con la derecha (una mano)", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "attackPowerStart_MC_1HMLeft", "nombre": "Ataque potente con la izquierda (una mano)", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "attackPowerStartDualWield", "nombre": "Ataque potente con las dos armas", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "attackPowerStartInPlaceLeftHand", "nombre": "Ataque potente en el sitio, con la izquierda", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "attackPowerStartBackLeftHand", "nombre": "Ataque potente hacia atrás, con la izquierda", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "attackPowerStartLeft", "nombre": "Ataque potente hacia la izquierda", "categoria": "combate", "descripcion": "Ataque potente con arma equipada", "visible": false},
      {"evento": "JumpLandEnd", "nombre": "Aterrizar", "categoria": "combate", "descripcion": "Animación de cierre al caer de un salto (No tiene movimiento)", "visible": false},
      {"evento": "JumpSoftEnd", "nombre": "Aterrizar con suavidad", "categoria": "combate", "descripcion": "Aterrizar con suavidad. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "JumpLandDirectional", "nombre": "Aterrizar de lado", "categoria": "combate", "descripcion": "Animación de cierre al caer de un salto mientras te mueves (No tiene movimiento)", "visible": false},
      {"evento": "JumpLand", "nombre": "Aterrizar de un salto", "categoria": "combate", "descripcion": "Aterrizar de un salto. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "JumpFall", "nombre": "Caer", "categoria": "combate", "descripcion": "Animación que se ejecuta automaticamente mientras cae el jugador (Aleteo mientras caes)", "visible": false},
      {"evento": "bleedOutStart", "nombre": "Caer abatido", "categoria": "combate", "descripcion": "Cae al suelo tocandose el estomago y en 4 patas derrotado"},
      {"evento": "bleedOutStop", "nombre": "Caer abatido (Levantarse)", "categoria": "combate", "descripcion": "Fade-out animación de bleedOutStart (Se levanta de estar abatido)"},
      {"evento": "JumpFallDirectional", "nombre": "Caer de lado", "categoria": "combate", "descripcion": "Caer de lado. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "MC_WeapOutRightReplaceForceEquip", "nombre": "Cambiar el arma de la derecha (2)", "categoria": "combate", "confirmado": false, "descripcion": "Desenfunda el arma equipada", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapOutLeftReplaceForceEquip", "nombre": "Cambiar el arma de la izquierda", "categoria": "combate", "descripcion": "Desenfunda el arma equipada izquierda", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "ShoutSprintLongStart", "nombre": "Carrera del Torbellino, larga", "categoria": "combate", "descripcion": "Grito de torbellino arrollador Nivel 1", "visible": false},
      {"evento": "ShoutSprintMediumStart", "nombre": "Carrera del Torbellino, media", "categoria": "combate", "descripcion": "Grito de torbellino arrollador Nivel 2", "visible": false},
      {"evento": "ShoutSprintLongestStart", "nombre": "Carrera del Torbellino, muy larga", "categoria": "combate", "descripcion": "Grito de torbellino arrollador Nivel 3", "visible": false},
      {"evento": "attackPowerStartH2HCombo", "nombre": "Combinación de puñetazos", "categoria": "combate", "descripcion": "Golpe cargado intercambiado entre ambos puños", "visible": false},
      {"evento": "RitualSpellOut", "nombre": "Cortar el hechizo ritual", "categoria": "combate", "descripcion": "Corta la animación del hechizo de alto nivel (los que usan dos manos para cargar el hechizo)", "visible": false},
      {"evento": "moveStop", "nombre": "Dejar de andar", "categoria": "combate", "descripcion": "Fade-outanimación de cuando caminas", "visible": false, "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "attackStop", "nombre": "Dejar de apuntar con el arco", "categoria": "combate", "descripcion": "Dejar de apuntar con el arco. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "blockStop", "nombre": "Dejar de bloquear", "categoria": "combate", "descripcion": "Fade-out animación de bloquear", "visible": false},
      {"evento": "SprintStop", "nombre": "Dejar de correr", "categoria": "combate", "descripcion": "Fade-out animación de correr", "visible": false},
      {"evento": "turnStop", "nombre": "Dejar de girar", "categoria": "combate", "descripcion": "Fade-out animación de girar", "visible": false, "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SwimStop", "nombre": "Dejar de nadar", "categoria": "combate", "descripcion": "Fade-out animación de nadar", "visible": false},
      {"evento": "WeapEquip", "nombre": "Desenvainar", "categoria": "combate", "descripcion": "Desenvaina el arma equipada", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "WeapSoloEquip", "nombre": "Desenvainar (sin nada más)", "categoria": "combate", "descripcion": "Desenvaina el arma equipada", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "bowAttackStart", "nombre": "Disparar el arco", "categoria": "combate", "descripcion": "Dispara con el arco equipado", "visible": false},
      {"evento": "crossbowAttackStart", "nombre": "Disparar la ballesta", "categoria": "combate", "confirmado": false, "descripcion": "Dispara con la ballesta equipada", "visible": false},
      {"evento": "crossbowDwarvenAttackStart", "nombre": "Disparar la ballesta mejorada", "categoria": "combate", "confirmado": false, "descripcion": "Dispara con la ballesta mejorada equipada", "visible": false},
      {"evento": "moveStart", "nombre": "Echar a andar", "categoria": "combate", "descripcion": "Comienza la animación de caminar (varia la velocidad de la animación)", "visible": false, "sincroniza": false, "motivo": "esta en la lista de eventos que SkyMP ignora"},
      {"evento": "SprintStart", "nombre": "Echar a correr", "categoria": "combate", "descripcion": "Comienza la animación de correr", "visible": false},
      {"evento": "shoutStart", "nombre": "Empezar un Grito", "categoria": "combate", "descripcion": "Inicia grito (bucle)", "visible": false},
      {"evento": "NPCshoutStart", "nombre": "Empezar un Grito (3)", "categoria": "combate", "descripcion": "Inicia grito (solo npcs)", "visible": false},
      {"evento": "RitualSpellStart", "nombre": "Empezar un hechizo ritual", "categoria": "combate", "descripcion": "Usa las dos manos para cargar un hechizo/ritual y quedarse cargando", "visible": false},
      {"evento": "idleRitualSpellStart", "nombre": "Empezar un hechizo ritual (pose)", "categoria": "combate", "confirmado": false, "descripcion": "Comenzar a cargar hechizo de 2 manos tipo ritual"},
      {"evento": "UnequipNoAnim", "nombre": "Envainar sin animación", "categoria": "combate", "descripcion": "Envaina arma sin animación, envaine directo.", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "IdleCombatStretchingStart", "nombre": "Estirar hombros (En guardia)", "categoria": "combate", "confirmado": false, "descripcion": "Estira tus brazos y hombros cuando estas en guardia"},
      {"evento": "IdleCombatSpecialStart", "nombre": "Estirar hombros 2 (En guardia)", "categoria": "combate", "confirmado": false, "descripcion": "Estira tus brazos y hombros cuando estas en guardia"},
      {"evento": "MT_BreathExhaleShort", "nombre": "Exhalar", "categoria": "combate", "descripcion": "Exhala nuestra respiración", "visible": false},
      {"evento": "CombatReady_BreathExhaleShort", "nombre": "Exhalar (En guardia)", "categoria": "combate", "descripcion": "Exhala nuestra respiración", "visible": false},
      {"evento": "BrakeStart", "nombre": "Frenar en seco", "categoria": "combate", "descripcion": "Frenar en seco. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnRight180", "nombre": "Girar 180 grados a la derecha", "categoria": "combate", "descripcion": "Girar 180 grados a la derecha. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnToWalkRight180", "nombre": "Girar 180 grados a la derecha y echar a andar", "categoria": "combate", "descripcion": "Girar 180 grados a la derecha y echar a andar. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnLeft180", "nombre": "Girar 180 grados a la izquierda", "categoria": "combate", "descripcion": "Girar 180 grados a la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnToWalkLeft180", "nombre": "Girar 180 grados a la izquierda y echar a andar", "categoria": "combate", "descripcion": "Girar 180 grados a la izquierda y echar a andar. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnRight90", "nombre": "Girar 90 grados a la derecha", "categoria": "combate", "descripcion": "Girar 90 grados a la derecha", "visible": false},
      {"evento": "NPC_TurnLeft90", "nombre": "Girar 90 grados a la izquierda", "categoria": "combate", "descripcion": "Girar 90 grados a la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnToWalkLeft90", "nombre": "Girar 90 grados a la izquierda y echar a andar", "categoria": "combate", "descripcion": "Girar 90 grados a la izquierda y echar a andar. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_TurnToWalkRight90", "nombre": "Girar 90 grados y echar a andar", "categoria": "combate", "descripcion": "Girar 90 grados a la derecha y anda", "visible": false},
      {"evento": "turnRight", "nombre": "Girar a la derecha", "categoria": "combate", "descripcion": "Inicia la animación de girar a la derecha", "visible": false},
      {"evento": "turnLeft", "nombre": "Girar a la izquierda", "categoria": "combate", "descripcion": "Inicia la animación de girar a la izquierda", "visible": false},
      {"evento": "bashFail", "nombre": "Golpe de escudo fallido", "categoria": "combate", "descripcion": "Arrazar con escudo y falla el golpe", "visible": false},
      {"evento": "BashFail", "nombre": "Golpe de escudo fallido (2)", "categoria": "combate", "confirmado": false, "descripcion": "Arrazar con escudo y falla el golpe", "visible": false},
      {"evento": "bashPowerStart", "nombre": "Golpe de escudo potente", "categoria": "combate", "descripcion": "Golpear con el escudo fuerte", "visible": false},
      {"evento": "StaffBashRelease", "nombre": "Golpear con el bastón", "categoria": "combate", "descripcion": "Golpea con el bastón", "visible": false},
      {"evento": "bashStart", "nombre": "Golpear con el escudo", "categoria": "combate", "descripcion": "Golpea con el escudo", "visible": false},
      {"evento": "shoutReleaseSlowTime", "nombre": "Grito: Tiempo Lento", "categoria": "combate", "descripcion": "Comenzar grito de Relentizar tiempo", "visible": false},
      {"evento": "torchUnequip", "nombre": "Guardar la antorcha", "categoria": "combate", "descripcion": "Guarda la antorcha equipada", "visible": false},
      {"evento": "Unequip", "nombre": "Guardar lo que lleves en las manos", "categoria": "combate", "descripcion": "Guardar lo que lleves en las manos. Forma parte del combate normal del juego.", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MLh_SpellAimedConcentrationStart", "nombre": "Hechizo de concentración, izquierda", "categoria": "combate", "descripcion": "Carga hechizo", "visible": false},
      {"evento": "MRh_Equipped_Event", "nombre": "Hechizo equipado en la derecha", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MLh_Equipped_Event", "nombre": "Hechizo equipado en la izquierda", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_SpellReady_Event", "nombre": "Hechizo listo en la derecha", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false},
      {"evento": "MLh_SpellReady_Event", "nombre": "Hechizo listo en la izquierda", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false},
      {"evento": "RitualSpellAimConcentrationStart", "nombre": "Hechizo ritual de concentración", "categoria": "combate", "descripcion": "Misma animación que RitualSpellStart", "visible": false},
      {"evento": "MRh_SpellSelfStart", "nombre": "Hechizo sobre uno mismo, derecha", "categoria": "combate", "descripcion": "Carga hechizo", "visible": false},
      {"evento": "wardAbsorb", "nombre": "La protección absorbe un hechizo", "categoria": "combate", "confirmado": false, "descripcion": "Carga hechizo", "visible": false},
      {"evento": "MLh_SpellSelfStart", "nombre": "Lanzarse un hechizo con la izquierda", "categoria": "combate", "descripcion": "Lanzarse un hechizo con la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "MRh_WardStart", "nombre": "Levantar protección con la derecha", "categoria": "combate", "descripcion": "Carga hechizo", "visible": false},
      {"evento": "MLh_WardStart", "nombre": "Levantar protección con la izquierda", "categoria": "combate", "descripcion": "Carga hechizo", "visible": false},
      {"evento": "SneakStop", "nombre": "Levantarse de agacharse", "categoria": "combate", "descripcion": "Animación básica del jugador para salir de agacharse (usada al usar el cntrl)", "visible": false, "sincroniza": false, "motivo": "SkyMP lo usa para su propio sincronizado de agacharse"},
      {"evento": "MRh_SpellAimedConcentrationStart", "nombre": "Mantener un hechizo apuntado con la derecha", "categoria": "combate", "descripcion": "Mantener un hechizo apuntado con la derecha. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "MRh_SpellSelfConcentrationStart", "nombre": "Mantenerse un hechizo con la derecha", "categoria": "combate", "descripcion": "Mantenerse un hechizo con la derecha. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "MLh_SpellSelfConcentrationStart", "nombre": "Mantenerse un hechizo con la izquierda", "categoria": "combate", "descripcion": "Mantenerse un hechizo con la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "IdleCombatLookingAroundStart", "nombre": "Mirar alrededor (En guardia)", "categoria": "combate", "confirmado": false, "descripcion": "Mirar alrededor cuandoe stas en guardia"},
      {"evento": "MagicForceEquipRight", "nombre": "Poner magia en la derecha", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicForceEquipLeft", "nombre": "Poner magia en la izquierda", "categoria": "combate", "descripcion": "Equipo hechizo", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicWeap_ForceEquip", "nombre": "Poner magia y arma", "categoria": "combate", "descripcion": "Equipo hechizo y arma", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "blockStart", "nombre": "Ponerse a bloquear", "categoria": "combate", "descripcion": "Comenzar animación de bloquear", "visible": false},
      {"evento": "SwimStart", "nombre": "Ponerse a nadar", "categoria": "combate", "descripcion": "Comenzar animación de nadar", "visible": false},
      {"evento": "combatStanceStart", "nombre": "Ponerse en guardia", "categoria": "combate", "descripcion": "Ponerse en guardia. Forma parte del combate normal del juego."},
      {"evento": "IdleCombatStart", "nombre": "Postura de combate", "categoria": "combate", "descripcion": "Comenzar animación de postura de combate", "visible": false},
      {"evento": "blockAnticipateStart", "nombre": "Prepararse para bloquear", "categoria": "combate", "descripcion": "Inicia la animación de bloquear", "visible": false},
      {"evento": "IdleCombatShieldStart", "nombre": "Provocar golpeando armas (En guardia)", "categoria": "combate", "descripcion": "Golpea tus armas para provocar"},
      {"evento": "AttackStartH2HRight", "nombre": "Puñetazo con la derecha", "categoria": "combate", "descripcion": "Golpear con puño con la derecha", "visible": false},
      {"evento": "AttackStartH2HLeft", "nombre": "Puñetazo con la izquierda", "categoria": "combate", "descripcion": "Golpear con puño con la izquierda", "visible": false},
      {"evento": "attackPowerStartForwardH2HRightHand", "nombre": "Puñetazo potente hacia delante, derecha", "categoria": "combate", "descripcion": "Golpear fuerte con el puño derecho", "visible": false},
      {"evento": "attackPowerStartForwardH2HLeftHand", "nombre": "Puñetazo potente hacia delante, izquierda", "categoria": "combate", "descripcion": "Golpear fuerte con el puño izquierdo", "visible": false},
      {"evento": "reloadStart", "nombre": "Recargar Ballesta", "categoria": "combate", "confirmado": false, "descripcion": "Recargar ballesta", "visible": false},
      {"evento": "NPC_BumpedFromRight", "nombre": "Recibir un empujón por la derecha", "categoria": "combate", "descripcion": "Recibir un empujón por la derecha. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_BumpedFromBack", "nombre": "Recibir un empujón por la espalda", "categoria": "combate", "descripcion": "Recibir un empujón por la espalda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "NPC_BumpedFromLeft", "nombre": "Recibir un empujón por la izquierda", "categoria": "combate", "descripcion": "Recibir un empujón por la izquierda. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "blockHitStart", "nombre": "Recibir un golpe con el bloqueo", "categoria": "combate", "descripcion": "Empieza la animación que detiene golpes con el escudo", "visible": false},
      {"evento": "recoilLargeStart", "nombre": "Retroceder de un golpetazo", "categoria": "combate", "descripcion": "Retrocede de un golpe", "visible": false},
      {"evento": "recoilStart", "nombre": "Retroceder por el golpe", "categoria": "combate", "descripcion": "Retrocede de un golpe rapido", "visible": false},
      {"evento": "FlinchStart", "nombre": "Retroceder por golpe", "categoria": "combate", "descripcion": "Retrocede por un golpe en la parte superior del cuerpo"},
      {"evento": "NPC_BumpFromFront", "nombre": "Retroceder por golpe 2", "categoria": "combate", "descripcion": "Eres empujado y retrocedes del golpe"},
      {"evento": "StaggerPlayer", "nombre": "Retroceder por golpe 3", "categoria": "combate", "descripcion": "Retrocede al ser golpeado"},
      {"evento": "staggerStart", "nombre": "Retroceder por golpe 3.2 (1)", "categoria": "combate", "descripcion": "Retrocede al ser golpeado", "visible": false},
      {"evento": "WardBreak", "nombre": "Retroceder por golpe 3.2 (2)", "categoria": "combate", "descripcion": "Retrocede al ser golpeado", "visible": false},
      {"evento": "IdleCombatWeaponCheckStart", "nombre": "Revisar arma (En guardia)", "categoria": "combate", "confirmado": false, "descripcion": "Revisa el arma desenvainada"},
      {"evento": "SneakSprintStartRoll", "nombre": "Rodar por el suelo agachado", "categoria": "combate", "descripcion": "Rodar por el suelo agachado. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "WeapOutRightReplaceForceEquip", "nombre": "Sacar Arma", "categoria": "combate", "descripcion": "Desenfunda el arma equipada", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "ShdEquip", "nombre": "Sacar el escudo", "categoria": "combate", "descripcion": "Saca el escudo equipado", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "torchEquip", "nombre": "Sacar la antorcha", "categoria": "combate", "descripcion": "Saca una antorcha y se mantiene"},
      {"evento": "torchForceEquip", "nombre": "Sacar la antorcha a la fuerza", "categoria": "combate", "descripcion": "Saca una antorcha y se mantiene", "visible": false},
      {"evento": "Magic_Equip", "nombre": "Sacar la magia", "categoria": "combate", "descripcion": "Desenvaina la mano preparada para lelvar hechizo", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "Magic_Solo_Equip", "nombre": "Sacar la magia (sin nada más)", "categoria": "combate", "descripcion": "Desenvaina la mano preparada para lelvar hechizo", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MagicForceEquip", "nombre": "Sacar la magia en las dos manos", "categoria": "combate", "descripcion": "Sacar la magia en las dos manos. Forma parte del combate normal del juego.", "visible": false, "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "combatStanceStop", "nombre": "Salir de la guardia", "categoria": "combate", "descripcion": "Salir de la guardia. Forma parte del combate normal del juego.", "visible": false},
      {"evento": "JumpStandingStart", "nombre": "Saltar en el sitio", "categoria": "combate", "descripcion": "Salta en el sitio", "visible": false},
      {"evento": "JumpDirectionalStart", "nombre": "Saltar hacia un lado", "categoria": "combate", "descripcion": "Salta hacia el lado derecho", "visible": false},
      {"evento": "attackRelease", "nombre": "Soltar el ataque", "categoria": "combate", "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "attackReleaseL", "nombre": "Soltar el ataque con la izquierda", "categoria": "combate", "confirmado": false, "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "bashRelease", "nombre": "Soltar el golpe de escudo", "categoria": "combate", "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "MRh_SpellRelease_Event", "nombre": "Soltar el hechizo con la derecha", "categoria": "combate", "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "MLh_SpellRelease_Event", "nombre": "Soltar el hechizo con la izquierda", "categoria": "combate", "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "MLH_SpellRelease_event", "nombre": "Soltar el hechizo con la izquierda (2)", "categoria": "combate", "confirmado": false, "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "idleRitualSpellRelease", "nombre": "Soltar el hechizo ritual (pose)", "categoria": "combate", "confirmado": false, "descripcion": "Suelta el ataque que se va a efectuar", "visible": false},
      {"evento": "swimForceEquip", "nombre": "Soltar lo que llevas al nadar", "categoria": "combate", "descripcion": "Fuerza soltar lo que lleves al nadar", "sincroniza": false, "motivo": "SkyMP convierte todo evento con equip en el nombre a SkympFakeEquip"},
      {"evento": "MRh_SpellTelekinesisStart", "nombre": "Telequinesis con la derecha", "categoria": "combate", "descripcion": "Estira el brazo para mover con telequinesis", "visible": false},
      {"evento": "MLh_SpellTelekinesisStart", "nombre": "Telequinesis con la izquierda", "categoria": "combate", "descripcion": "Estira el brazo para mover con telequinesis", "visible": false},
      {"evento": "bowEnd", "nombre": "Terminar con el arco", "categoria": "combate", "confirmado": false, "descripcion": "Termina al lanzar una flecha", "visible": false},
      {"evento": "shoutStop", "nombre": "Terminar el Grito", "categoria": "combate", "descripcion": "Terminar de gritar", "visible": false},
      {"evento": "VampireFeedingBedRollRight", "nombre": "Alimentarse en el saco de dormir, por la derecha", "categoria": "comer", "descripcion": "Alimentarse en el saco de dormir, por la derecha. Necesita: estar acostado en la cama o en un saco de dormir."},
      {"evento": "VampireFeedingBedRollLeft", "nombre": "Alimentarse en el saco de dormir, por la izquierda", "categoria": "comer", "descripcion": "Alimentarse en el saco de dormir, por la izquierda. Necesita: estar acostado en la cama o en un saco de dormir."},
      {"evento": "VampireFeedingBedRight", "nombre": "Alimentarse en la cama, por la derecha", "categoria": "comer", "descripcion": "Alimentarse en la cama, por la derecha."},
      {"evento": "VampireFeedingBedLeft", "nombre": "Alimentarse en la cama, por la izquierda", "categoria": "comer", "descripcion": "Alimentarse en la cama, por la izquierda."},
      {"evento": "IdleDrink", "nombre": "Beber", "categoria": "comer", "destacada": true, "descripcion": "Beber."},
      {"evento": "IdleDrinkFromFountain", "nombre": "Beber de la fuente", "categoria": "comer", "descripcion": "Beber de la fuente."},
      {"evento": "idleDrinkingStandingStart", "nombre": "Beber de pie", "categoria": "comer", "destacada": true, "descripcion": "Beber de pie."},
      {"evento": "idleBarDrinkingStart", "nombre": "Beber en el mostrador", "categoria": "comer", "confirmado": false, "descripcion": "Beber en el mostrador."},
      {"evento": "IdleMQ201Drink", "nombre": "Beber en la fiesta", "categoria": "comer", "descripcion": "Beber en la fiesta."},
      {"evento": "ChairVampireEatingStart", "nombre": "Beber sangre sentado", "categoria": "comer", "sentado": true, "descripcion": "Beber sangre sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "ChairDrinkingStart", "nombre": "Beber sentado", "categoria": "comer", "sentado": true, "descripcion": "Beber sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleDrinkPotion", "nombre": "Beberse una poción", "categoria": "comer", "descripcion": "Beber una poción."},
      {"evento": "IdleMQ201ToastStart", "nombre": "Brindar", "categoria": "comer", "descripcion": "Brindar."},
      {"evento": "idleEatingStandingStart_DLC1Vampire", "nombre": "Comer carne cruda de pie", "categoria": "comer", "descripcion": "Comer carne cruda de pie."},
      {"evento": "ChairEatingStart_VampireMeat", "nombre": "Comer carne cruda sentado", "categoria": "comer", "sentado": true, "descripcion": "Comer carne cruda sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "idleEatingStandingStart", "nombre": "Comer de pie", "categoria": "comer", "destacada": true, "descripcion": "Comer de pie."},
      {"evento": "ChairEatingStart", "nombre": "Comer sentado", "categoria": "comer", "sentado": true, "descripcion": "Comer sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "DrunkStop", "nombre": "Dejar de tambalearse", "categoria": "comer", "descripcion": "Dejar de tambalearse. Necesita: estar ya haciendo esa animación."},
      {"evento": "IdleTablePassOutEnter", "nombre": "Desplomarse sobre la mesa", "categoria": "comer", "descripcion": "Desplomarse sobre la mesa. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleCannibalFeedStanding", "nombre": "Devorar de pie", "categoria": "comer", "descripcion": "Devorar de pie."},
      {"evento": "IdleCannibalFeedCrouching", "nombre": "Devorar en cuclillas", "categoria": "comer", "descripcion": "Devorar en cuclillas. Necesita: estar agachado."},
      {"evento": "pa_VampireFeedStanding_Front", "nombre": "Morder el cuello de frente", "categoria": "comer", "descripcion": "Morder el cuello de frente. Necesita: necesita un arma desenvainada, de cualquier tipo."},
      {"evento": "pa_VampireFeedStanding_Back", "nombre": "Morder el cuello por la espalda", "categoria": "comer", "descripcion": "Morder el cuello por la espalda. Necesita: necesita un arma desenvainada, de cualquier tipo."},
      {"evento": "DrunkStart", "nombre": "Ponerse a tambalearse", "categoria": "comer", "descripcion": "Ponerse a tambalearse."},
      {"evento": "IdleTableDrinkEnter", "nombre": "Sentarse a la mesa a beber", "categoria": "comer", "descripcion": "Sentarse a la mesa a beber. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleTableDrinkAndMugEnter", "nombre": "Sentarse a la mesa con jarra y bebida", "categoria": "comer", "descripcion": "Sentarse a la mesa con jarra y bebida. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleTableMugEnter", "nombre": "Sentarse a la mesa con una jarra", "categoria": "comer", "descripcion": "Sentarse a la mesa con una jarra. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleTG03UseMeadBarrel", "nombre": "Servirse del barril de hidromiel", "categoria": "comer", "descripcion": "Servirse del barril de hidromiel."},
      {"evento": "IdleMQ201HoldingDrinkTray", "nombre": "Sostener una bandeja de bebidas", "categoria": "comer", "descripcion": "Sostener una bandeja de bebidas."},
      {"evento": "IdleEatSoup", "nombre": "Tomar sopa", "categoria": "comer", "sentado": true, "descripcion": "Tomar sopa. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "ChairEatingSoupStart", "nombre": "Tomar sopa sentado", "categoria": "comer", "sentado": true, "descripcion": "Tomar sopa sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleFurnitureExit", "nombre": "Levantarse del mueble", "categoria": "control", "busqueda": "levantarse salir silla cama mueble", "descripcion": "Levantarse del mueble. Necesita: estar en el mueble o la mesa de trabajo.", "visible": false},
      {"evento": "IdleStop", "nombre": "Parar la animación", "categoria": "control", "descripcion": "Parar la animación. Necesita: estar ya haciendo esa animación."},
      {"evento": "IdleForceDefaultState", "nombre": "Parar y volver a la postura normal", "categoria": "control", "busqueda": "parar detener cancelar normal quieto", "destacada": true, "descripcion": "Parar y volver a la postura normal."},
      {"evento": "OffsetStop", "nombre": "Soltar lo que lleva en las manos", "categoria": "control", "busqueda": "soltar dejar manos", "descripcion": "Soltar lo que lleva en las manos. Necesita: estar ya haciendo esa animación."},
      {"evento": "RF_OpenStart", "nombre": "Actitud: cercana", "categoria": "dialogo", "descripcion": "Actitud: cercana.", "visible": false},
      {"evento": "RF_GuardedStart", "nombre": "Actitud: distante", "categoria": "dialogo", "descripcion": "Actitud: distante.", "visible": false},
      {"evento": "RF_PlayfulStart", "nombre": "Actitud: juguetona", "categoria": "dialogo", "descripcion": "Actitud: juguetona.", "visible": false},
      {"evento": "RF_SeriousStart", "nombre": "Actitud: seria", "categoria": "dialogo", "descripcion": "Actitud: seria.", "visible": false},
      {"evento": "RF_MoodChangeOpen", "nombre": "Cambiar a actitud cercana", "categoria": "dialogo", "descripcion": "Cambiar a actitud cercana.", "visible": false},
      {"evento": "RF_MoodChangeGuarded", "nombre": "Cambiar a actitud distante", "categoria": "dialogo", "descripcion": "Cambiar a actitud distante.", "visible": false},
      {"evento": "RF_MoodChangePlayful", "nombre": "Cambiar a actitud juguetona", "categoria": "dialogo", "descripcion": "Cambiar a actitud juguetona.", "visible": false},
      {"evento": "RF_MoodChangeSerious", "nombre": "Cambiar a actitud seria", "categoria": "dialogo", "descripcion": "Cambiar a actitud seria.", "visible": false},
      {"evento": "RF_OpenDismissive_In", "nombre": "Cercana: desdén", "categoria": "dialogo", "descripcion": "Cercana: desdén.", "visible": false},
      {"evento": "RF_OpenInterested_In", "nombre": "Cercana: interés", "categoria": "dialogo", "descripcion": "Cercana: interés.", "visible": false},
      {"evento": "RF_OpenThrowHands_In", "nombre": "Cercana: manos al aire", "categoria": "dialogo", "descripcion": "Cercana: manos al aire.", "visible": false},
      {"evento": "RF_Shock_Open", "nombre": "Cercana: sobresalto", "categoria": "dialogo", "descripcion": "Cercana: sobresalto.", "visible": false},
      {"evento": "RF_OpenPleading_In", "nombre": "Cercana: súplica", "categoria": "dialogo", "descripcion": "Cercana: súplica.", "visible": false},
      {"evento": "RF_GuardedDismissive_In", "nombre": "Distante: desdén", "categoria": "dialogo", "descripcion": "Distante: desdén.", "visible": false},
      {"evento": "RF_GuardedInterested_In", "nombre": "Distante: interés", "categoria": "dialogo", "descripcion": "Distante: interés.", "visible": false},
      {"evento": "RF_GuardedThrowHands_In", "nombre": "Distante: manos al aire", "categoria": "dialogo", "descripcion": "Distante: manos al aire.", "visible": false},
      {"evento": "RF_Shock_Guarded", "nombre": "Distante: sobresalto", "categoria": "dialogo", "descripcion": "Distante: sobresalto.", "visible": false},
      {"evento": "RF_GuardedPleading_In", "nombre": "Distante: súplica", "categoria": "dialogo", "descripcion": "Distante: súplica.", "visible": false},
      {"evento": "IdleDialogueHappyStart", "nombre": "Empezar a hablar contento", "categoria": "dialogo", "descripcion": "Empezar a hablar contento. Necesita: estar en una conversación."},
      {"evento": "PairEnd", "nombre": "Fin de la escena en pareja", "categoria": "dialogo", "descripcion": "Fin de la escena en pareja."},
      {"evento": "IdleDialogueDefensiveHandGesture", "nombre": "Gesto a la defensiva", "categoria": "dialogo", "descripcion": "Hacer un gesto a la defensiva. Necesita: estar en una conversación."},
      {"evento": "IdleDialogueWelcomeHandGesture", "nombre": "Gesto de bienvenida", "categoria": "dialogo", "descripcion": "Hacer un gesto de bienvenida. Necesita: estar en una conversación."},
      {"evento": "IdleDialogueStart", "nombre": "Hablar", "categoria": "dialogo", "descripcion": "Hablar. Necesita: estar en una conversación."},
      {"evento": "IdleDialogueMovingTalkA", "nombre": "Hablar andando (A)", "categoria": "dialogo", "andando": true, "descripcion": "Hablar andando (A). Necesita: estar en una conversación."},
      {"evento": "IdleDialogueMovingTalkB", "nombre": "Hablar andando (B)", "categoria": "dialogo", "andando": true, "descripcion": "Hablar andando (B). Necesita: estar en una conversación."},
      {"evento": "IdleDialogueMovingTalkC", "nombre": "Hablar andando (C)", "categoria": "dialogo", "andando": true, "descripcion": "Hablar andando (C). Necesita: estar en una conversación."},
      {"evento": "IdleDialogueMovingTalkD", "nombre": "Hablar andando (D)", "categoria": "dialogo", "andando": true, "descripcion": "Hablar andando (D). Necesita: estar en una conversación."},
      {"evento": "DialogueNeutral", "nombre": "Hablar con naturalidad", "categoria": "dialogo", "descripcion": "Hablar con naturalidad. Necesita: estar en una conversación.", "visible": false},
      {"evento": "DialogueGeneric", "nombre": "Hablar con normalidad", "categoria": "dialogo", "descripcion": "Hablar con normalidad. Necesita: estar en una conversación."},
      {"evento": "DialogueHappy", "nombre": "Hablar contento", "categoria": "dialogo", "descripcion": "Hablar contento. Necesita: estar en una conversación."},
      {"evento": "IdleDialogueAngryStart", "nombre": "Hablar enojado", "categoria": "dialogo", "descripcion": "Hablar enojado. Necesita: estar en una conversación.", "visible": false},
      {"evento": "DialogueAngry", "nombre": "Hablar enojado (1)", "categoria": "dialogo", "descripcion": "Hablar enojado (1). Necesita: estar en una conversación."},
      {"evento": "MotionDrivenDialogueAngry", "nombre": "Hablar enojado mientras te mueves", "categoria": "dialogo", "andando": true, "confirmado": false, "descripcion": "Hablar enojado mientras te mueves. Necesita: estar en una conversación.", "visible": false},
      {"evento": "IdleDialogueExpressiveStart", "nombre": "Hablar gesticulando", "categoria": "dialogo", "descripcion": "Hablar gesticulando. Necesita: estar en una conversación.", "visible": false},
      {"evento": "MotionDrivenDialogueGeneric", "nombre": "Hablar mientras te mueves", "categoria": "dialogo", "andando": true, "confirmado": false, "descripcion": "Hablar mientras te mueves. Necesita: estar en una conversación.", "visible": false},
      {"evento": "IdleSnowElfPrinceChairDialogue", "nombre": "Hablar sentado con gesto solemne", "categoria": "dialogo", "sentado": true, "descripcion": "Hablar sentado con gesto solemne. Necesita: estar sentado en una silla, banco o taburete.", "visible": false},
      {"evento": "MotionDrivenDialogueNextClip", "nombre": "Hablar: cambiar de gesto", "categoria": "dialogo", "andando": true, "confirmado": false, "descripcion": "Hablar: cambiar de gesto. Necesita: estar en una conversación.", "visible": false},
      {"evento": "RF_PlayfulDismissive_In", "nombre": "Juguetona: desdén", "categoria": "dialogo", "descripcion": "Juguetona: desdén."},
      {"evento": "RF_PlayfulInterested_In", "nombre": "Juguetona: interés", "categoria": "dialogo", "descripcion": "Juguetona: interés."},
      {"evento": "RF_PlayfulThrowHands_In", "nombre": "Juguetona: manos al aire", "categoria": "dialogo", "descripcion": "Juguetona: manos al aire."},
      {"evento": "RF_Shock_Playful", "nombre": "Juguetona: sobresalto", "categoria": "dialogo", "descripcion": "Juguetona: sobresalto."},
      {"evento": "RF_PlayfulPleading_In", "nombre": "Juguetona: súplica", "categoria": "dialogo", "descripcion": "Juguetona: súplica."},
      {"evento": "IdleDialogueHandOnChinGesture", "nombre": "Mano en la barbilla", "categoria": "dialogo", "descripcion": "Mano en la barbilla. Necesita: estar en una conversación."},
      {"evento": "RF_Talk_In", "nombre": "Ponerse a hablar", "categoria": "dialogo", "descripcion": "Ponerse a hablar. Necesita: estar en una conversación."},
      {"evento": "MotionDrivenIdle", "nombre": "Quedarse quieto al hablar", "categoria": "dialogo", "descripcion": "Quedarse quieto al hablar."},
      {"evento": "LooseDialogueResponseNegative", "nombre": "Responder que no", "categoria": "dialogo", "descripcion": "Responder que no. Necesita: estar en una conversación."},
      {"evento": "LooseDialogueResponsePositive", "nombre": "Responder que sí", "categoria": "dialogo", "descripcion": "Responder que sí. Necesita: estar en una conversación."},
      {"evento": "RF_SeriousDismissive_In", "nombre": "Seria: desdén", "categoria": "dialogo", "descripcion": "Seria: desdén."},
      {"evento": "RF_SeriousInterested_In", "nombre": "Seria: interés", "categoria": "dialogo", "descripcion": "Seria: interés."},
      {"evento": "RF_SeriousThrowHands_In", "nombre": "Seria: manos al aire", "categoria": "dialogo", "descripcion": "Seria: manos al aire."},
      {"evento": "RF_Shock_Serious", "nombre": "Seria: sobresalto", "categoria": "dialogo", "descripcion": "Seria: sobresalto."},
      {"evento": "RF_SeriousPleading_In", "nombre": "Seria: súplica", "categoria": "dialogo", "descripcion": "Seria: súplica."},
      {"evento": "RF_Idle_Out", "nombre": "Volver a la actitud normal", "categoria": "dialogo", "descripcion": "Volver a la actitud normal."},
      {"evento": "IdleCoffinEnter", "nombre": "Acostarse (Ataúd)", "categoria": "dormir", "descripcion": "Se acuesta con manos en el abdomen y cerrando los ojos"},
      {"evento": "IdleBedRollFrontEnterStart", "nombre": "Acostarse (Saco)", "categoria": "dormir", "descripcion": "Se acuesta en un saco de dormir"},
      {"evento": "IdleCoffinHorzEnter", "nombre": "Acostarse 2 (Ataúd)", "categoria": "dormir", "descripcion": "Se acuesta en un ataúd con manos a los lados"},
      {"evento": "IdleLayDownEnter", "nombre": "Acostarse en el suelo", "categoria": "dormir", "descripcion": "Acostarse en el suelo."},
      {"evento": "IdleBedRightEnterStart", "nombre": "Acostarse por la derecha (Cama)", "categoria": "dormir", "descripcion": "Acostarse en una cama por la derecha", "visible": false},
      {"evento": "IdleBedRollRightEnterStart", "nombre": "Acostarse por la derecha (Saco)", "categoria": "dormir", "descripcion": "Se acuesta en un saco de dormir por la derecha"},
      {"evento": "IdleBedLeftEnterStart", "nombre": "Acostarse por la izquierda (Cama)", "categoria": "dormir", "destacada": true, "descripcion": "Acostarse en una cama por la izquierda", "visible": false},
      {"evento": "IdleBedRollLeftEnterStart", "nombre": "Acostarse por la izquierda (Saco)", "categoria": "dormir", "descripcion": "Se acuesta en un saco de dormir por la izquierda"},
      {"evento": "DLC01CoffinEnterInstant", "nombre": "Acostarse verticalmente (Ataúd)", "categoria": "dormir", "descripcion": "Se acuesta en un ataúd vertical con brazos cruzados"},
      {"evento": "IdleCoffinVertEnter", "nombre": "Acostarse verticalmente 2 (Ataúd)", "categoria": "dormir", "descripcion": "Se mete en el ataúd vertical para acostarse con brazos abajos"},
      {"evento": "IdleSleepNod", "nombre": "Dar cabezadas", "categoria": "dormir", "descripcion": "Dar cabezadas del sueño"},
      {"evento": "IdleBedExitStart", "nombre": "Levantarse (Cama)", "categoria": "dormir", "descripcion": "Levantarse de una cama", "visible": false},
      {"evento": "Idle_1stPersonWoozyGetUpFromBed", "nombre": "Levantarse de la cama aturdido (1ª persona)", "categoria": "dormir", "descripcion": "Levantarse de una cama aturdido", "visible": false},
      {"evento": "IdleBedQuickExitStart", "nombre": "Levantarse rápido (Cama)", "categoria": "dormir", "descripcion": "Levantarse de una cama rapidamente", "visible": false},
      {"evento": "IdleChildLayOnFloor", "nombre": "Tumbarse boca abajo", "categoria": "dormir", "descripcion": "Tumbarse en el suelo con cabeza apoyada en los brazos y piernas juguetonas"},
      {"evento": "pa_HugA", "nombre": "Abrazar a alguien", "categoria": "gestos", "descripcion": "Abrazar a alguien. Necesita: necesita un arma desenvainada, de cualquier tipo."},
      {"evento": "IdleMT_DoorBang", "nombre": "Aporrear una puerta", "categoria": "gestos", "descripcion": "Aporrear una puerta."},
      {"evento": "IdleKneelingEnter", "nombre": "Arrodillarse (1)", "categoria": "gestos", "destacada": true, "descripcion": "Arrodillarse."},
      {"evento": "IdleKneeling", "nombre": "Arrodillarse junto a un cadáver", "categoria": "gestos", "descripcion": "Arrodillarse junto a un cadáver."},
      {"evento": "IdleWallCornerPeekREnter", "nombre": "Asomarse por la esquina, a la derecha", "categoria": "gestos", "descripcion": "Asomarse por la esquina, a la derecha.", "visible": false},
      {"evento": "IdleWallCornerPeekLEnter", "nombre": "Asomarse por la esquina, a la izquierda", "categoria": "gestos", "descripcion": "Asomarse por la esquina, a la izquierda.", "visible": false},
      {"evento": "idle_A_sway_fastTrans", "nombre": "Balancearse", "categoria": "gestos", "descripcion": "Balancearse."},
      {"evento": "IdleChildTaunt1", "nombre": "Burlarse (1)", "categoria": "gestos", "descripcion": "Burlarse (1)."},
      {"evento": "IdleChildTaunt2", "nombre": "Burlarse (2)", "categoria": "gestos", "descripcion": "Burlarse (2)."},
      {"evento": "IdleChildTaunt3", "nombre": "Burlarse (3)", "categoria": "gestos", "descripcion": "Burlarse (3)."},
      {"evento": "IdleChildTaunt4", "nombre": "Burlarse (4)", "categoria": "gestos", "descripcion": "Burlarse (4)."},
      {"evento": "IdleWarmHands", "nombre": "Calentarse las manos", "categoria": "gestos", "descripcion": "Calentarse las manos."},
      {"evento": "IdleWarmHandsStanding", "nombre": "Calentarse las manos de pie", "categoria": "gestos", "destacada": true, "descripcion": "Calentarse las manos de pie."},
      {"evento": "IdleWarmHandsCrouched", "nombre": "Calentarse las manos en cuclillas", "categoria": "gestos", "descripcion": "Calentarse las manos en cuclillas. Necesita: estar agachado."},
      {"evento": "IdleWarmArms", "nombre": "Calentarse los brazos", "categoria": "gestos", "descripcion": "Calentarse los brazos."},
      {"evento": "idle_A_leg_shift", "nombre": "Cambiar el peso de pierna", "categoria": "gestos", "descripcion": "Cambiar el peso de pierna.", "visible": false},
      {"evento": "IdleValericaWalkForward", "nombre": "Caminar hacia delante", "categoria": "gestos", "andando": true, "descripcion": "Caminar hacia delante.", "visible": false},
      {"evento": "idle_A_left_longTrans", "nombre": "Cargar el peso a la izquierda", "categoria": "gestos", "descripcion": "Cargar el peso a la izquierda.", "visible": false},
      {"evento": "OffsetArmsCrossedStart", "nombre": "Cruzarse de brazos", "categoria": "gestos", "destacada": true, "andando": true, "descripcion": "Cruzarse de brazos. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleCiceroHappy", "nombre": "Dar saltos de alegría", "categoria": "gestos", "descripcion": "Dar saltos de alegría."},
      {"evento": "IdleChildCryingEnd", "nombre": "Dejar de llorar", "categoria": "gestos", "descripcion": "Dejar de llorar."},
      {"evento": "IdleCowering", "nombre": "Encogerse de miedo", "categoria": "gestos", "destacada": true, "descripcion": "Encogerse de miedo."},
      {"evento": "IdleCowerEnter", "nombre": "Encogerse de miedo (empezar)", "categoria": "gestos", "descripcion": "Encogerse de miedo (empezar)."},
      {"evento": "IdleHideREnter", "nombre": "Esconderse a la derecha", "categoria": "gestos", "descripcion": "Esconderse a la derecha.", "visible": false},
      {"evento": "idle_A_swat_flies", "nombre": "Espantar moscas", "categoria": "gestos", "descripcion": "Espantar moscas."},
      {"evento": "idle_A_shoulders", "nombre": "Estirar los hombros", "categoria": "gestos", "descripcion": "Estirar los hombros."},
      {"evento": "idle_A_shouldersVar1", "nombre": "Estirar los hombros (2)", "categoria": "gestos", "descripcion": "Estirar los hombros (2)."},
      {"evento": "IdleWalkingCameraEnd", "nombre": "Fin del paseo de cámara", "categoria": "gestos", "descripcion": "Fin del paseo de cámara."},
      {"evento": "IdleCiceroAgitated", "nombre": "Gesticular alterado", "categoria": "gestos", "descripcion": "Gesticular alterado."},
      {"evento": "IdleHDRight", "nombre": "Gesto hacia la derecha (variante HD)", "categoria": "gestos", "confirmado": false, "descripcion": "Hacer un gesto hacia la derecha (variante HD)."},
      {"evento": "IdleHHRight", "nombre": "Gesto hacia la derecha (variante HH)", "categoria": "gestos", "confirmado": false, "descripcion": "Hacer un gesto hacia la derecha (variante HH)."},
      {"evento": "IdleTalkAndUseItem", "nombre": "Hablar manejando algo", "categoria": "gestos", "descripcion": "Hablar manejando algo. Necesita: estar en una conversación."},
      {"evento": "IdleComeThisWay", "nombre": "Hacer señas para que te sigan", "categoria": "gestos", "destacada": true, "descripcion": "Hacer señas para que te sigan."},
      {"evento": "IdleGrave_01", "nombre": "Inclinar la cabeza ante una tumba", "categoria": "gestos", "descripcion": "Inclinar la cabeza ante una tumba."},
      {"evento": "IdleGrave_02", "nombre": "Inclinar la cabeza ante una tumba (2)", "categoria": "gestos", "descripcion": "Inclinar la cabeza ante una tumba (2)."},
      {"evento": "IdleSilentBow", "nombre": "Inclinarse en silencio", "categoria": "gestos", "descripcion": "Inclinarse en silencio. Necesita: necesita un arco equipado."},
      {"evento": "idleDisbelief01Start", "nombre": "Incredulidad", "categoria": "gestos", "descripcion": "Mostrar incredulidad."},
      {"evento": "idleDisbelief02Start", "nombre": "Incredulidad (2)", "categoria": "gestos", "descripcion": "Mostrar incredulidad (2)."},
      {"evento": "idleFreaReactionStart", "nombre": "Incredulidad (3)", "categoria": "gestos", "descripcion": "Mostrar incredulidad (3)."},
      {"evento": "IdleFreaReaction2Start", "nombre": "Incredulidad (4)", "categoria": "gestos", "descripcion": "Mostrar incredulidad (4)."},
      {"evento": "IdleChildPlayDirt", "nombre": "Jugar con la tierra", "categoria": "gestos", "descripcion": "Jugar con la tierra."},
      {"evento": "IdleChildPlayDoll", "nombre": "Jugar con una muñeca", "categoria": "gestos", "descripcion": "Jugar con una muñeca."},
      {"evento": "idle_A_soft_rightTrans", "nombre": "Ladearse a la derecha", "categoria": "gestos", "descripcion": "Ladearse a la derecha."},
      {"evento": "IdleCleanSword", "nombre": "Limpiar la espada", "categoria": "gestos", "descripcion": "Limpiar la espada."},
      {"evento": "IdleGetAttention", "nombre": "Llamar la atención", "categoria": "gestos", "descripcion": "Llamar la atención."},
      {"evento": "IdleChildCryingStart", "nombre": "Llorar", "categoria": "gestos", "descripcion": "Llorar."},
      {"evento": "IdleHandsBehindBack", "nombre": "Manos a la espalda", "categoria": "gestos", "destacada": true, "descripcion": "Manos a la espalda."},
      {"evento": "IdlePresentSkeletonKey", "nombre": "Mostrar la Llave Maestra", "categoria": "gestos", "descripcion": "Mostrar la Llave Maestra."},
      {"evento": "IdleChildFidget", "nombre": "Moverse inquieto", "categoria": "gestos", "descripcion": "Moverse inquieto."},
      {"evento": "IdleNervous", "nombre": "Nerviosismo", "categoria": "gestos", "destacada": true, "descripcion": "Ponerse nervioso."},
      {"evento": "IdleLookFar", "nombre": "Otear el horizonte", "categoria": "gestos", "descripcion": "Otear el horizonte."},
      {"evento": "IdleWalkingCameraStart", "nombre": "Paseo de cámara", "categoria": "gestos", "descripcion": "Paseo de cámara.", "visible": false},
      {"evento": "IdleChildApologize", "nombre": "Pedir perdón", "categoria": "gestos", "descripcion": "Pedir perdón."},
      {"evento": "idleFreaSorrowLoopEnter", "nombre": "Pena", "categoria": "gestos", "descripcion": "Pena."},
      {"evento": "IdleSnapToAttention", "nombre": "Ponerse firme", "categoria": "gestos", "destacada": true, "descripcion": "Ponerse firme."},
      {"evento": "IdleAstridEnter", "nombre": "Pose de espera", "categoria": "gestos", "descripcion": "Adoptar la pose de espera.", "visible": false},
      {"evento": "IdleStaticPoseAStart", "nombre": "Pose fija A", "categoria": "gestos", "descripcion": "Adoptar la pose fija A.", "visible": false},
      {"evento": "IdleStaticPoseBStart", "nombre": "Pose fija B", "categoria": "gestos", "descripcion": "Adoptar la pose fija B.", "visible": false},
      {"evento": "IdleStaticPoseCStart", "nombre": "Pose fija C", "categoria": "gestos", "descripcion": "Adoptar la pose fija C.", "visible": false},
      {"evento": "IdlePlayer", "nombre": "Postura del jugador", "categoria": "gestos", "descripcion": "Adoptar la postura del jugador."},
      {"evento": "IdleChildWhineKick", "nombre": "Rabieta a patadas", "categoria": "gestos", "descripcion": "Rabieta a patadas."},
      {"evento": "IdleChildWhineStompFeet", "nombre": "Rabieta pataleando", "categoria": "gestos", "descripcion": "Rabieta pataleando."},
      {"evento": "idle_A_scratch_back", "nombre": "Rascarse la espalda", "categoria": "gestos", "descripcion": "Rascarse la espalda."},
      {"evento": "IdleSurrender", "nombre": "Rendirse", "categoria": "gestos", "destacada": true, "descripcion": "Rendirse."},
      {"evento": "IdleLaugh", "nombre": "Reírse", "categoria": "gestos", "destacada": true, "descripcion": "Reírse."},
      {"evento": "idle_A_shakeout", "nombre": "Sacudirse", "categoria": "gestos", "descripcion": "Sacudirse."},
      {"evento": "idleDisbelief01Exit", "nombre": "Salir de la incredulidad", "categoria": "gestos", "descripcion": "Salir de la incredulidad. Necesita: estar ya haciendo esa animación."},
      {"evento": "idleDisbelief02Exit", "nombre": "Salir de la incredulidad (2)", "categoria": "gestos", "descripcion": "Salir de la incredulidad (2). Necesita: estar ya haciendo esa animación."},
      {"evento": "idleFreaDisbeliefLoopStop", "nombre": "Salir de la incredulidad (3)", "categoria": "gestos", "descripcion": "Salir de la incredulidad (3). Necesita: estar ya haciendo esa animación.", "visible": false},
      {"evento": "IdleFreaDisbelief2LoopStop", "nombre": "Salir de la incredulidad (4)", "categoria": "gestos", "descripcion": "Salir de la incredulidad (4). Necesita: estar ya haciendo esa animación.", "visible": false},
      {"evento": "idleFreaSorrowExit", "nombre": "Salir de la pena", "categoria": "gestos", "descripcion": "Salir de la pena. Necesita: estar ya haciendo esa animación."},
      {"evento": "IdleWave", "nombre": "Saludar con la mano", "categoria": "gestos", "destacada": true, "descripcion": "Saludar con la mano."},
      {"evento": "IdleSalute", "nombre": "Saludo militar", "categoria": "gestos", "destacada": true, "descripcion": "Saludar al modo militar."},
      {"evento": "IdleWipeBrow", "nombre": "Secarse la frente", "categoria": "gestos", "descripcion": "Secarse la frente."},
      {"evento": "IdlePointFar_01", "nombre": "Señalar a lo lejos", "categoria": "gestos", "destacada": true, "descripcion": "Señalar a lo lejos."},
      {"evento": "IdlePointFar_02", "nombre": "Señalar a lo lejos (2)", "categoria": "gestos", "descripcion": "Señalar a lo lejos (2)."},
      {"evento": "IdlePointClose", "nombre": "Señalar algo cerca", "categoria": "gestos", "descripcion": "Señalar algo cerca."},
      {"evento": "idle_A_pull_pants", "nombre": "Subirse los pantalones", "categoria": "gestos", "descripcion": "Subirse los pantalones.", "visible": false},
      {"evento": "idle_A_sigh_var1Trans", "nombre": "Suspirar", "categoria": "gestos", "descripcion": "Suspirar.", "visible": false},
      {"evento": "idle_A_sigh_var2Trans", "nombre": "Suspirar (2)", "categoria": "gestos", "descripcion": "Suspirar (2).", "visible": false},
      {"evento": "IdleChildShy", "nombre": "Timidez", "categoria": "gestos", "descripcion": "Timidez."},
      {"evento": "IdleNocturnal_LookRight", "nombre": "Volver la mirada a la derecha", "categoria": "gestos", "descripcion": "Volver la mirada a la derecha.", "visible": false},
      {"evento": "IdleNocturnal_LookLeft", "nombre": "Volver la mirada a la izquierda", "categoria": "gestos", "descripcion": "Volver la mirada a la izquierda.", "visible": false},
      {"evento": "IdleBracedPain", "nombre": "Aguantar el dolor", "categoria": "herido", "descripcion": "Aguantar el dolor."},
      {"evento": "IdlePrisonerBeat", "nombre": "Apalear a un preso", "categoria": "herido", "descripcion": "Apalear a un preso. Necesita: estar maniatado o preso."},
      {"evento": "TG05_StabPlayer", "nombre": "Apuñalar al jugador", "categoria": "herido", "descripcion": "Apuñalar al jugador."},
      {"evento": "IdleBoundKneesStart", "nombre": "Arrodillarse maniatado", "categoria": "herido", "descripcion": "Arrodillarse maniatado. Necesita: estar maniatado o preso."},
      {"evento": "IdleDLC02FallOnKnees", "nombre": "Caer de rodillas", "categoria": "herido", "descripcion": "Caer de rodillas. Necesita: estar ya en movimiento.", "visible": false},
      {"evento": "BoundStandingCut", "nombre": "Cortar las ataduras", "categoria": "herido", "descripcion": "Cortar las ataduras. Necesita: estar maniatado o preso."},
      {"evento": "BoundStandingCutNPC", "nombre": "Cortarle las ataduras a alguien", "categoria": "herido", "descripcion": "Cortarle las ataduras a alguien. Necesita: estar maniatado o preso."},
      {"evento": "IdleHandCut", "nombre": "Cortarse la mano", "categoria": "herido", "descripcion": "Cortarse la mano."},
      {"evento": "IdleBoundKneesEnterInstant", "nombre": "De rodillas y maniatado", "categoria": "herido", "descripcion": "De rodillas y maniatado. Necesita: estar maniatado o preso."},
      {"evento": "IdleExecutionerChop_Player", "nombre": "Decapitar al jugador", "categoria": "herido", "descripcion": "Decapitar al jugador."},
      {"evento": "IdleExecutionerChop", "nombre": "Decapitar con el hacha", "categoria": "herido", "descripcion": "Decapitar con el hacha."},
      {"evento": "IdleVampireFeastVictim", "nombre": "Dejarse morder el cuello", "categoria": "herido", "descripcion": "Dejarse morder el cuello."},
      {"evento": "Ragdoll", "nombre": "Desplomarse como un muñeco", "categoria": "herido", "descripcion": "Desplomarse como un muñeco. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "IdleExecutioneeIdle", "nombre": "Esperar como condenado", "categoria": "herido", "descripcion": "Esperar como condenado."},
      {"evento": "IdleExecutionerIdle", "nombre": "Esperar como verdugo", "categoria": "herido", "descripcion": "Esperar como verdugo."},
      {"evento": "IdleWebThrashShort", "nombre": "Forcejear en la telaraña", "categoria": "herido", "descripcion": "Forcejear en la telaraña.", "visible": false},
      {"evento": "IdleWebThrashShort2", "nombre": "Forcejear en la telaraña (2)", "categoria": "herido", "descripcion": "Forcejear en la telaraña (2).", "visible": false},
      {"evento": "IdleExecutionGuardIdle", "nombre": "Guardia de la ejecución", "categoria": "herido", "descripcion": "Guardia de la ejecución."},
      {"evento": "IdleInjured", "nombre": "Herido", "categoria": "herido", "destacada": true, "descripcion": "Quedar herido."},
      {"evento": "IdleWounded_01", "nombre": "Herido (1)", "categoria": "herido", "destacada": true, "descripcion": "Quedar herido (1)."},
      {"evento": "IdleWounded_02", "nombre": "Herido (2)", "categoria": "herido", "descripcion": "Quedar herido (2)."},
      {"evento": "IdleWounded_03", "nombre": "Herido (3)", "categoria": "herido", "descripcion": "Quedar herido (3)."},
      {"evento": "TG05_GetUp", "nombre": "Levantarse aturdido", "categoria": "herido", "descripcion": "Levantarse aturdido. Necesita: estar ya haciendo esa animación."},
      {"evento": "GetUpBegin", "nombre": "Levantarse del suelo", "categoria": "herido", "descripcion": "Levantarse del suelo. Necesita: estar ya haciendo esa animación.", "visible": false},
      {"evento": "OffsetBoundStandingStart", "nombre": "Maniatado de pie", "categoria": "herido", "andando": true, "descripcion": "Maniatado de pie. Necesita: estar maniatado o preso."},
      {"evento": "DeathAnim", "nombre": "Morir", "categoria": "herido", "descripcion": "Morir. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "IdleDLC02MiraakDeath", "nombre": "Morir despacio", "categoria": "herido", "descripcion": "Morir despacio. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "MS12BedDeath", "nombre": "Morir en la cama", "categoria": "herido", "descripcion": "Morir en la cama. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "IdleSoupDeath", "nombre": "Morir sobre el plato", "categoria": "herido", "descripcion": "Morir sobre el plato. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "IdleCartPrisonerAExit", "nombre": "Preso A: bajarse del carro", "categoria": "herido", "descripcion": "Preso A: bajarse del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerAIdle", "nombre": "Preso A: en el carro", "categoria": "herido", "descripcion": "Preso A: en el carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerASway", "nombre": "Preso A: vaivén del carro", "categoria": "herido", "descripcion": "Preso A: vaivén del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerBExit", "nombre": "Preso B: bajarse del carro", "categoria": "herido", "descripcion": "Preso B: bajarse del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerBIdle", "nombre": "Preso B: en el carro", "categoria": "herido", "descripcion": "Preso B: en el carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerBSway", "nombre": "Preso B: vaivén del carro", "categoria": "herido", "descripcion": "Preso B: vaivén del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerCExit", "nombre": "Preso C: bajarse del carro", "categoria": "herido", "descripcion": "Preso C: bajarse del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerCIdle", "nombre": "Preso C: en el carro", "categoria": "herido", "descripcion": "Preso C: en el carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerCSway", "nombre": "Preso C: vaivén del carro", "categoria": "herido", "descripcion": "Preso C: vaivén del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerDExit", "nombre": "Preso D: bajarse del carro", "categoria": "herido", "descripcion": "Preso D: bajarse del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerDIdle", "nombre": "Preso D: en el carro", "categoria": "herido", "descripcion": "Preso D: en el carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartPrisonerDSway", "nombre": "Preso D: vaivén del carro", "categoria": "herido", "descripcion": "Preso D: vaivén del carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleWebEnterInstant", "nombre": "Quedar atrapado en la telaraña", "categoria": "herido", "descripcion": "Quedar atrapado en la telaraña.", "visible": false},
      {"evento": "TG05_KnockOut", "nombre": "Quedar inconsciente", "categoria": "herido", "descripcion": "Quedar inconsciente."},
      {"evento": "IdleExecutionerAlduinReaction", "nombre": "Reaccionar con espanto", "categoria": "herido", "descripcion": "Reaccionar con espanto."},
      {"evento": "IdleExecutionerAlduinReactionDeath", "nombre": "Reaccionar con espanto y morir", "categoria": "herido", "descripcion": "Reaccionar con espanto y morir. Necesita: estar muerto o abatido."},
      {"evento": "IdleExecutioneeChop", "nombre": "Recibir el golpe de hacha del verdugo", "categoria": "herido", "descripcion": "Recibir el golpe de hacha del verdugo."},
      {"evento": "IdleFurnitureExitTriggered", "nombre": "Salir del mueble (forzado)", "categoria": "herido", "descripcion": "Salir del mueble (forzado). Necesita: estar en el mueble o la mesa de trabajo.", "visible": false},
      {"evento": "IdleWebExit", "nombre": "Soltarse de la telaraña", "categoria": "herido", "descripcion": "Soltarse de la telaraña. Necesita: estar ya haciendo esa animación.", "visible": false},
      {"evento": "IdleWebExitQuickTurn", "nombre": "Soltarse de la telaraña y girarse", "categoria": "herido", "descripcion": "Soltarse de la telaraña y girarse.", "visible": false},
      {"evento": "IdleDLC02MiraakDeathFinish", "nombre": "Terminar de morir despacio", "categoria": "herido", "descripcion": "Terminar de morir despacio. Necesita: estar muerto o abatido.", "visible": false},
      {"evento": "IdleUncontrollableCough", "nombre": "Tos incontrolable", "categoria": "herido", "descripcion": "Tos incontrolable."},
      {"evento": "IdleMQ203EsbernBookEnter", "nombre": "Consultar un libro", "categoria": "leer", "descripcion": "Consultar un libro."},
      {"evento": "IdleStudy", "nombre": "Estudiar", "categoria": "leer", "destacada": true, "descripcion": "Estudiar."},
      {"evento": "IdleReadElderScroll", "nombre": "Leer el Pergamino Ancestral", "categoria": "leer", "descripcion": "Leer el Pergamino Ancestral."},
      {"evento": "IdleReadElderScroll3rdP", "nombre": "Leer el Pergamino Ancestral (3ª persona)", "categoria": "leer", "descripcion": "Leer el Pergamino Ancestral (3ª persona)."},
      {"evento": "IdleReadElderScrollLonger", "nombre": "Leer el Pergamino Ancestral (largo)", "categoria": "leer", "descripcion": "Leer el Pergamino Ancestral (largo)."},
      {"evento": "ChairReadingStart", "nombre": "Leer sentado", "categoria": "leer", "sentado": true, "descripcion": "Leer sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "ChairReadingIdles", "nombre": "Leer sentado: pasar páginas", "categoria": "leer", "sentado": true, "descripcion": "Leer sentado: pasar páginas. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleBook_Read", "nombre": "Leer un libro", "categoria": "leer", "destacada": true, "descripcion": "Leer un libro."},
      {"evento": "IdleBook_ReadTG06", "nombre": "Leer un libro (traducción)", "categoria": "leer", "descripcion": "Leer un libro (traducción)."},
      {"evento": "IdleNoteRead", "nombre": "Leer una nota", "categoria": "leer", "destacada": true, "descripcion": "Leer una nota."},
      {"evento": "IdleMQ206FelldirShowScroll", "nombre": "Mostrar el pergamino", "categoria": "leer", "descripcion": "Mostrar el pergamino."},
      {"evento": "IdleTG06FlipPage", "nombre": "Pasar la página", "categoria": "leer", "descripcion": "Pasar la página."},
      {"evento": "IdleBook_PageTurn", "nombre": "Pasar páginas", "categoria": "leer", "descripcion": "Pasar páginas."},
      {"evento": "IdleBook_OnePage", "nombre": "Pasar una página", "categoria": "leer", "descripcion": "Pasar una página."},
      {"evento": "IdleReadElderScrollEnd", "nombre": "Terminar de leer el Pergamino Ancestral", "categoria": "leer", "descripcion": "Terminar de leer el Pergamino Ancestral."},
      {"evento": "IdleTG06TranslationEnter", "nombre": "Traducir un texto", "categoria": "leer", "descripcion": "Traducir un texto."},
      {"evento": "IdleDLC2TentacleWarpBook", "nombre": "Abrir el libro que te transporta", "categoria": "magia", "descripcion": "Abrir el libro que te transporta. Forma parte de lanzar hechizos."},
      {"evento": "IdleBloodPortalActivate", "nombre": "Activar el portal de sangre", "categoria": "magia", "descripcion": "Activar el portal de sangre. Forma parte de lanzar hechizos."},
      {"evento": "DualMagic_WardStart", "nombre": "Alzar una protección con las dos manos", "categoria": "magia", "descripcion": "Alzar una protección con las dos manos. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleNocturnal_Rise", "nombre": "Alzarse", "categoria": "magia", "descripcion": "Levantarse. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleTGFalmerStatueEnter", "nombre": "Ante una estatua", "categoria": "magia", "descripcion": "Ante una estatua. Forma parte de lanzar hechizos."},
      {"evento": "IdleNocturnalEnter", "nombre": "Aparecer", "categoria": "magia", "descripcion": "Aparecer. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleBlessingKneelEnter", "nombre": "Arrodillarse a recibir la bendición", "categoria": "magia", "destacada": true, "descripcion": "Arrodillarse a recibir la bendición. Forma parte de lanzar hechizos."},
      {"evento": "IdleAltarEnter", "nombre": "Arrodillarse en el altar", "categoria": "magia", "descripcion": "Arrodillarse en el altar. Forma parte de lanzar hechizos."},
      {"evento": "IdleT02AscendMale", "nombre": "Ascender (hombre)", "categoria": "magia", "descripcion": "Ascender (hombre). Forma parte de lanzar hechizos."},
      {"evento": "IdleT02AscendFemale", "nombre": "Ascender (mujer)", "categoria": "magia", "descripcion": "Ascender (mujer). Forma parte de lanzar hechizos."},
      {"evento": "IdleTelvanniTowerFloatUp", "nombre": "Ascender flotando", "categoria": "magia", "descripcion": "Ascender flotando. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleSnowElfPrinceAscensionBurning", "nombre": "Ascensión en llamas", "categoria": "magia", "descripcion": "Ascensión en llamas. Forma parte de lanzar hechizos."},
      {"evento": "IdleDA02BoethiahPostEnter", "nombre": "Atado a un poste", "categoria": "magia", "descripcion": "Atado a un poste. Forma parte de lanzar hechizos."},
      {"evento": "IdleWalkThroughWallEnter", "nombre": "Atravesar la pared", "categoria": "magia", "descripcion": "Atravesar la pared. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleTG08_Phase1", "nombre": "Ceremonia del Gremio: fase 1", "categoria": "magia", "descripcion": "Celebrar la ceremonia del Gremio: fase 1. Forma parte de lanzar hechizos."},
      {"evento": "IdleTG08_Phase2", "nombre": "Ceremonia del Gremio: fase 2", "categoria": "magia", "descripcion": "Celebrar la ceremonia del Gremio: fase 2. Forma parte de lanzar hechizos."},
      {"evento": "IdleTG08_Phase3", "nombre": "Ceremonia del Gremio: fase 3", "categoria": "magia", "descripcion": "Celebrar la ceremonia del Gremio: fase 3. Forma parte de lanzar hechizos."},
      {"evento": "IdleTG08_Phase4", "nombre": "Ceremonia del Gremio: fase 4", "categoria": "magia", "descripcion": "Celebrar la ceremonia del Gremio: fase 4. Forma parte de lanzar hechizos."},
      {"evento": "IdleTG08_Phase5", "nombre": "Ceremonia del Gremio: fase 5", "categoria": "magia", "descripcion": "Celebrar la ceremonia del Gremio: fase 5. Forma parte de lanzar hechizos."},
      {"evento": "IdleCO2Ceremony3Chest", "nombre": "Ceremonia: abrir el cofre", "categoria": "magia", "descripcion": "Ceremonia: abrir el cofre. Forma parte de lanzar hechizos."},
      {"evento": "IdleCO2Ceremony2Blessing", "nombre": "Ceremonia: bendecir", "categoria": "magia", "descripcion": "Ceremonia: bendecir. Forma parte de lanzar hechizos."},
      {"evento": "IdleCO2Ceremony1Welcome", "nombre": "Ceremonia: dar la bienvenida", "categoria": "magia", "descripcion": "Ceremonia: dar la bienvenida. Forma parte de lanzar hechizos."},
      {"evento": "pa_WW_CutWrist", "nombre": "Cortarse la muñeca", "categoria": "magia", "confirmado": false, "descripcion": "Cortarse la muñeca. Forma parte de lanzar hechizos."},
      {"evento": "IdleMesmerizeStop", "nombre": "Dejar de hipnotizar", "categoria": "magia", "descripcion": "Dejar de hipnotizar. Forma parte de lanzar hechizos."},
      {"evento": "IdleNocturnal_Exit", "nombre": "Desaparecer", "categoria": "magia", "descripcion": "Desaparecer. Forma parte de lanzar hechizos."},
      {"evento": "IdleTelvanniTowerFloatDown", "nombre": "Descender flotando", "categoria": "magia", "descripcion": "Descender flotando. Forma parte de lanzar hechizos."},
      {"evento": "IdleRitualStart", "nombre": "Empezar un ritual", "categoria": "magia", "descripcion": "Empezar un ritual. Forma parte de lanzar hechizos."},
      {"evento": "IdleGreybeardWordTeach", "nombre": "Enseñar una Palabra", "categoria": "magia", "descripcion": "Enseñar una Palabra. Forma parte de lanzar hechizos."},
      {"evento": "IdleDLC1BossExplosion1stP", "nombre": "Explosión (1ª persona)", "categoria": "magia", "descripcion": "Explosión (1ª persona). Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "pa_ExtractWerewolfSpirit", "nombre": "Extraer un espíritu", "categoria": "magia", "descripcion": "Extraer un espíritu. Forma parte de lanzar hechizos."},
      {"evento": "IdleMagic_01", "nombre": "Gesto de magia", "categoria": "magia", "descripcion": "Hacer un gesto de magia. Forma parte de lanzar hechizos."},
      {"evento": "IdleDLC02TentacleWordBurnBegin", "nombre": "Grabar la Palabra (empezar)", "categoria": "magia", "descripcion": "Grabar la Palabra (empezar). Forma parte de lanzar hechizos."},
      {"evento": "IdleDLC02TentacleWordBurnEnd", "nombre": "Grabar la Palabra (terminar)", "categoria": "magia", "descripcion": "Grabar la Palabra (terminar). Forma parte de lanzar hechizos."},
      {"evento": "IdleDLC02TentacleWordBurnStart", "nombre": "Grabar la Palabra en la piedra negra", "categoria": "magia", "descripcion": "Grabar la Palabra en la piedra negra. Forma parte de lanzar hechizos."},
      {"evento": "IdleSnowElfPrinceBigSpell", "nombre": "Gran hechizo", "categoria": "magia", "descripcion": "Gran hechizo. Forma parte de lanzar hechizos."},
      {"evento": "IdleMesmerize", "nombre": "Hipnotizar", "categoria": "magia", "descripcion": "Hipnotizar. Forma parte de lanzar hechizos."},
      {"evento": "DualMagic_SpellAimedStart", "nombre": "Lanzar un hechizo con las dos manos", "categoria": "magia", "descripcion": "Lanzar un hechizo con las dos manos. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleSnowElfPrinceFireAndForget", "nombre": "Lanzar un hechizo sentado", "categoria": "magia", "descripcion": "Lanzar un hechizo sentado. Forma parte de lanzar hechizos."},
      {"evento": "DualMagic_SpellSelfStart", "nombre": "Lanzarse un hechizo con las dos manos", "categoria": "magia", "descripcion": "Lanzarse un hechizo con las dos manos. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "DualMagic_SpellAimedConcentrationStart", "nombre": "Mantener un hechizo con las dos manos", "categoria": "magia", "descripcion": "Mantener un hechizo con las dos manos. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "DualMagic_SpellSelfConcentrationStart", "nombre": "Mantenerse un hechizo con las dos manos", "categoria": "magia", "descripcion": "Mantenerse un hechizo con las dos manos. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleGreybeardMeditateEnter", "nombre": "Meditar", "categoria": "magia", "descripcion": "Meditar. Forma parte de lanzar hechizos."},
      {"evento": "IdleNocturnal_IdleA", "nombre": "Pose solemne", "categoria": "magia", "descripcion": "Adoptar la pose solemne. Forma parte de lanzar hechizos."},
      {"evento": "IdleNocturnal_IdleB", "nombre": "Pose solemne (2)", "categoria": "magia", "descripcion": "Adoptar la pose solemne (2). Forma parte de lanzar hechizos."},
      {"evento": "IdleNocturnal_IdleAMirror", "nombre": "Pose solemne (reflejada)", "categoria": "magia", "descripcion": "Adoptar la pose solemne (reflejada). Forma parte de lanzar hechizos."},
      {"evento": "IdleWayShrineWaterScoopEnter", "nombre": "Recoger agua del santuario", "categoria": "magia", "descripcion": "Recoger agua del santuario. Forma parte de lanzar hechizos."},
      {"evento": "IdlePray", "nombre": "Rezar", "categoria": "magia", "destacada": true, "descripcion": "Rezar. Forma parte de lanzar hechizos."},
      {"evento": "IdlePrayCrouchedEnter", "nombre": "Rezar en cuclillas", "categoria": "magia", "descripcion": "Rezar en cuclillas. Forma parte de lanzar hechizos."},
      {"evento": "IdleBoyRitual", "nombre": "Ritual", "categoria": "magia", "descripcion": "Celebrar el ritual. Forma parte de lanzar hechizos."},
      {"evento": "IdleRitualSkull1", "nombre": "Ritual con la calavera (1)", "categoria": "magia", "descripcion": "Celebrar el ritual con la calavera (1). Forma parte de lanzar hechizos."},
      {"evento": "IdleRitualSkull2", "nombre": "Ritual con la calavera (2)", "categoria": "magia", "descripcion": "Celebrar el ritual con la calavera (2). Forma parte de lanzar hechizos."},
      {"evento": "IdleRitualSkull3", "nombre": "Ritual con la calavera (3)", "categoria": "magia", "descripcion": "Celebrar el ritual con la calavera (3). Forma parte de lanzar hechizos."},
      {"evento": "IdleMQ206FelldirRitualEnter", "nombre": "Ritual con las manos en alto", "categoria": "magia", "descripcion": "Celebrar el ritual con las manos en alto. Forma parte de lanzar hechizos."},
      {"evento": "IdleSnowElfPrinceBigSpellRelease", "nombre": "Soltar el gran hechizo", "categoria": "magia", "descripcion": "Soltar el gran hechizo. Forma parte de lanzar hechizos."},
      {"evento": "SpellRelease", "nombre": "Soltar el hechizo", "categoria": "magia", "descripcion": "Soltar el hechizo. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleWerewolfTransformation", "nombre": "Transformarse", "categoria": "magia", "descripcion": "Transformarse. Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleVampireLordTransformation", "nombre": "Transformarse (2)", "categoria": "magia", "descripcion": "Transformarse (2). Forma parte de lanzar hechizos.", "visible": false},
      {"evento": "IdleWayShrineWaterPourEnter", "nombre": "Verter agua en el santuario", "categoria": "magia", "descripcion": "Verter agua en el santuario. Forma parte de lanzar hechizos."},
      {"evento": "DragonMountExit", "nombre": "Bajar del dragón", "categoria": "montar", "descripcion": "Animación de bajarse de dragón", "visible": false},
      {"evento": "Ground_Dismount_Dragon", "nombre": "Bajar del dragón en tierra", "categoria": "montar", "descripcion": "Animación de bajarse de dragón mientras el dragón está en el suelo", "visible": false},
      {"evento": "MountedSwimStop", "nombre": "Dejar de nadar montado", "categoria": "montar", "descripcion": "Fade-out animación de montar", "visible": false},
      {"evento": "HorseExit", "nombre": "Desmontar del caballo", "categoria": "montar", "descripcion": "Bajarse del caballo", "visible": false},
      {"evento": "HorseExitSwim", "nombre": "Desmontar del caballo en el agua", "categoria": "montar", "descripcion": "Bajarse del caballo estando en el agua", "visible": false},
      {"evento": "MC_shoutStart", "nombre": "Empezar un Grito (2)", "categoria": "montar", "descripcion": "Inicia grito (bucle)", "visible": false},
      {"evento": "HorseEnter", "nombre": "Montar a caballo", "categoria": "montar", "descripcion": "Montarse en un caballo", "visible": false},
      {"evento": "DragonMountEnter", "nombre": "Montar en el dragón", "categoria": "montar", "descripcion": "Montarse en un dragón", "visible": false},
      {"evento": "MountedSwimStart", "nombre": "Nadar montado", "categoria": "montar", "descripcion": "Nadar mientras estás montado", "visible": false},
      {"evento": "MountedStaggerStart", "nombre": "Retroceder por golpe (Montado)", "categoria": "montar", "descripcion": "Retrocede al ser golpeado mientras vas montado", "visible": false},
      {"evento": "StrafeReverseLeft", "nombre": "Cambiar el paso de lado a la derecha", "categoria": "moverse", "descripcion": "Cambiar el paso de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeReverseRight", "nombre": "Cambiar el paso de lado a la izquierda", "categoria": "moverse", "descripcion": "Cambiar el paso de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStopRunRight", "nombre": "Dejar de correr de lado a la derecha", "categoria": "moverse", "descripcion": "Dejar de correr de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStopRunLeft", "nombre": "Dejar de correr de lado a la izquierda", "categoria": "moverse", "descripcion": "Dejar de correr de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStopRight", "nombre": "Dejar de moverse de lado a la derecha", "categoria": "moverse", "descripcion": "Dejar de moverse de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStopLeft", "nombre": "Dejar de moverse de lado a la izquierda", "categoria": "moverse", "descripcion": "Dejar de moverse de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "BlockBashSprint", "nombre": "Embestir con el escudo al correr a toda velocidad", "categoria": "moverse", "descripcion": "Embestir con el escudo al correr a toda velocidad. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartWalkRight", "nombre": "Empezar a andar de lado a la derecha", "categoria": "moverse", "descripcion": "Empezar a andar de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartRunRight", "nombre": "Empezar a correr de lado a la derecha", "categoria": "moverse", "descripcion": "Empezar a correr de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartRunLeft", "nombre": "Empezar a correr de lado a la izquierda", "categoria": "moverse", "descripcion": "Empezar a correr de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartRight", "nombre": "Empezar a moverse de lado a la derecha", "categoria": "moverse", "descripcion": "Empezar a moverse de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartLeft", "nombre": "Empezar a moverse de lado a la izquierda", "categoria": "moverse", "descripcion": "Empezar a moverse de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartTrotRight", "nombre": "Empezar a trotar de lado a la derecha", "categoria": "moverse", "descripcion": "Empezar a trotar de lado a la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeStartTrotLeft", "nombre": "Empezar a trotar de lado a la izquierda", "categoria": "moverse", "descripcion": "Empezar a trotar de lado a la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "cannedTurnRight180", "nombre": "Girar 180 grados a la derecha en el sitio", "categoria": "moverse", "descripcion": "Girar 180 grados a la derecha en el sitio. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "cannedTurnLeft180", "nombre": "Girar 180 grados a la izquierda en el sitio", "categoria": "moverse", "descripcion": "Girar 180 grados a la izquierda en el sitio. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "cannedTurnRight90", "nombre": "Girar 90 grados a la derecha en el sitio", "categoria": "moverse", "descripcion": "Girar 90 grados a la derecha en el sitio. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "cannedTurnLeft90", "nombre": "Girar 90 grados a la izquierda en el sitio", "categoria": "moverse", "descripcion": "Girar 90 grados a la izquierda en el sitio. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeBackRight", "nombre": "Moverse de lado hacia atrás por la derecha", "categoria": "moverse", "descripcion": "Moverse de lado hacia atrás por la derecha. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "StrafeBackLeft", "nombre": "Moverse de lado hacia atrás por la izquierda", "categoria": "moverse", "descripcion": "Moverse de lado hacia atrás por la izquierda. Es parte del movimiento normal del personaje.", "visible": false},
      {"evento": "IdleApplaud2", "nombre": "Aplaudir", "categoria": "musica", "destacada": true, "descripcion": "Aplaudir."},
      {"evento": "IdleApplaud3", "nombre": "Aplaudir (2)", "categoria": "musica", "descripcion": "Aplaudir (2)."},
      {"evento": "IdleApplaud4", "nombre": "Aplaudir (3)", "categoria": "musica", "descripcion": "Aplaudir (3)."},
      {"evento": "IdleApplaud5", "nombre": "Aplaudir (4)", "categoria": "musica", "descripcion": "Aplaudir (4)."},
      {"evento": "IdleApplaudSarcastic", "nombre": "Aplaudir con sorna", "categoria": "musica", "descripcion": "Aplaudir con sorna."},
      {"evento": "IdleCiceroDance1", "nombre": "Baile (1)", "categoria": "musica", "destacada": true, "descripcion": "Bailar (1)."},
      {"evento": "IdleCiceroDance2", "nombre": "Baile (2)", "categoria": "musica", "descripcion": "Bailar (2)."},
      {"evento": "IdleCiceroDance3", "nombre": "Baile (3)", "categoria": "musica", "descripcion": "Bailar (3)."},
      {"evento": "SpectatorClap", "nombre": "Público: aplaudir", "categoria": "musica", "descripcion": "Público: aplaudir."},
      {"evento": "SpectatorTalking", "nombre": "Público: cuchichear", "categoria": "musica", "descripcion": "Público: cuchichear. Necesita: estar en una conversación."},
      {"evento": "SpectatorGawk", "nombre": "Público: quedarse boquiabierto", "categoria": "musica", "descripcion": "Público: quedarse boquiabierto."},
      {"evento": "SpectatorCheer", "nombre": "Público: vitorear", "categoria": "musica", "descripcion": "Público: vitorear."},
      {"evento": "IdleBlowHornStormcloak", "nombre": "Tocar el cuerno de los Capas de la Tormenta", "categoria": "musica", "descripcion": "Tocar el cuerno de los Capas de la Tormenta."},
      {"evento": "IdleBlowHornImperial", "nombre": "Tocar el cuerno imperial", "categoria": "musica", "descripcion": "Tocar el cuerno imperial."},
      {"evento": "IdleLuteStart", "nombre": "Tocar el laúd", "categoria": "musica", "destacada": true, "descripcion": "Tocar el laúd."},
      {"evento": "IdleDrumStart", "nombre": "Tocar el tambor", "categoria": "musica", "destacada": true, "descripcion": "Tocar el tambor."},
      {"evento": "IdleFluteStart", "nombre": "Tocar la flauta", "categoria": "musica", "destacada": true, "descripcion": "Tocar la flauta."},
      {"evento": "IdleCivilWarCheer", "nombre": "Vitorear", "categoria": "musica", "descripcion": "Vitorear."},
      {"evento": "IdleActivateDoor", "nombre": "Abrir una puerta", "categoria": "oficios", "descripcion": "Abrir una puerta."},
      {"evento": "IdleActivateCoffinPuzzle", "nombre": "Accionar el cuenco del ataúd", "categoria": "oficios", "descripcion": "Accionar botón con pincho del ataúd", "visible": false},
      {"evento": "Lever_PlayerPush", "nombre": "Accionar una palanca", "categoria": "oficios", "descripcion": "Acciona palanca", "visible": false},
      {"evento": "IdleSharpeningWheelStart", "nombre": "Afilar arma", "categoria": "oficios", "descripcion": "Sentarse a afilar el arma", "visible": false},
      {"evento": "IdleTake", "nombre": "Agarrar algo", "categoria": "oficios", "descripcion": "Agarrar algo."},
      {"evento": "IdleHoe", "nombre": "Arar suelo", "categoria": "oficios", "destacada": true, "descripcion": "Ara el suelo con una azada"},
      {"evento": "IdleCartDriverExit", "nombre": "Bajarse de la carreta", "categoria": "oficios", "descripcion": "Bajarse de la carreta", "visible": false},
      {"evento": "idleLooseSweepingStart", "nombre": "Barrer", "categoria": "oficios", "destacada": true, "descripcion": "Barre el suelo con una escoba"},
      {"evento": "IdleMillLoadStart", "nombre": "Cargar grano en el molino", "categoria": "oficios", "descripcion": "Cargar grano en el molino. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleChiselStandingEnter", "nombre": "Cincelar de pie", "categoria": "oficios", "descripcion": "Cincela con martillo y cincel hacia adelante"},
      {"evento": "IdleChiselKneelingEnter", "nombre": "Cincelar de rodillas", "categoria": "oficios", "descripcion": "Cincela con martillo y cincel en el suelo"},
      {"evento": "IdleCraftingCookingPotTalkA", "nombre": "Cocinar y hablar (A)", "categoria": "oficios", "descripcion": "Habla mientras cocinas en el cookingpot", "visible": false},
      {"evento": "IdleCraftingCookingPotTalkB", "nombre": "Cocinar y hablar (B)", "categoria": "oficios", "descripcion": "Habla mientras cocinas en el cookingpot", "visible": false},
      {"evento": "IdleWoodChopStart", "nombre": "Cortar leña", "categoria": "oficios", "destacada": true, "descripcion": "Cortar leña."},
      {"evento": "IdleFeedChicken", "nombre": "Dar de comer a las gallinas", "categoria": "oficios", "descripcion": "Dar de comer a las gallinas."},
      {"evento": "IdlewoodputdownEnter", "nombre": "Dejar la leña", "categoria": "oficios", "confirmado": false, "descripcion": "Dejar la leña."},
      {"evento": "IdleStonePutDownEnter", "nombre": "Dejar una piedra", "categoria": "oficios", "descripcion": "Dejar una piedra. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleCraftingCookingPotAddIngredient", "nombre": "Echar un ingrediente a la olla", "categoria": "oficios", "descripcion": "Echar un ingrediente a la olla. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleLeverPushStart", "nombre": "Empujar una palanca", "categoria": "oficios", "descripcion": "Empujar una palanca."},
      {"evento": "IdleLightSconce", "nombre": "Encender una antorcha de pared", "categoria": "oficios", "descripcion": "Encender una antorcha de pared."},
      {"evento": "IdleGive", "nombre": "Entregar algo", "categoria": "oficios", "descripcion": "Entregar algo."},
      {"evento": "IdleGiveMQ105Horn", "nombre": "Entregar el cuerno", "categoria": "oficios", "descripcion": "Entregar el cuerno."},
      {"evento": "IdleWriteTableStandingEnter", "nombre": "Escribir de pie en la mesa", "categoria": "oficios", "descripcion": "Escribir de pie en la mesa. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleWriteLedgerEnter", "nombre": "Escribir en el registro", "categoria": "oficios", "descripcion": "Escribir en el registro."},
      {"evento": "IdleWriteLedgerWrite", "nombre": "Escribir en el registro (escribiendo)", "categoria": "oficios", "descripcion": "Escribir en el registro (escribiendo)."},
      {"evento": "IdleChairWrite", "nombre": "Escribir sentado", "categoria": "oficios", "sentado": true, "descripcion": "Escribir sentado. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleExamine", "nombre": "Examinar algo", "categoria": "oficios", "descripcion": "Examinar algo."},
      {"evento": "IdleLockPick", "nombre": "Forzar una cerradura", "categoria": "oficios", "descripcion": "Forzar una cerradura."},
      {"evento": "IdleDLC02BoatRide", "nombre": "Ir en barca", "categoria": "oficios", "descripcion": "Ir en barca.", "visible": false},
      {"evento": "IdleWriteTableChairRightExit", "nombre": "Levantarse del escritorio por la derecha", "categoria": "oficios", "descripcion": "Levantarse del escritorio por la derecha. Necesita: estar sentado en una silla.", "visible": false},
      {"evento": "IdleWriteTableChairLeftExit", "nombre": "Levantarse del escritorio por la izquierda", "categoria": "oficios", "descripcion": "Levantarse del escritorio por la izquierda. Necesita: estar sentado en una silla.", "visible": false},
      {"evento": "IdleFurnitureExitSlow", "nombre": "Levantarse despacio del mueble", "categoria": "oficios", "descripcion": "Levantarse despacio del mueble. Necesita: estar en el mueble o la mesa de trabajo.", "visible": false},
      {"evento": "IdleBarCounterWipe", "nombre": "Limpiar el mostrador", "categoria": "oficios", "descripcion": "Limpiar el mostrador. Necesita: estar en el mostrador o el mostrador."},
      {"evento": "IdleCarryBucketFillEnter", "nombre": "Llenar una cubeta", "categoria": "oficios", "descripcion": "Llenar una cubeta. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleCartDriverIdle", "nombre": "Llevar el carro", "categoria": "oficios", "andando": true, "descripcion": "Llevar el carro. Necesita: estar subido en el carro."},
      {"evento": "IdleCartDriverSway", "nombre": "Llevar el carro, con vaivén", "categoria": "oficios", "andando": true, "descripcion": "Llevar el carro, con vaivén. Necesita: estar subido en el carro."},
      {"evento": "OffsetFlowerBasketStart", "nombre": "Llevar el cesto de flores", "categoria": "oficios", "andando": true, "descripcion": "Llevar el cesto de flores. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "OffsetCarryBasketStart", "nombre": "Llevar un cesto", "categoria": "oficios", "andando": true, "descripcion": "Llevar un cesto. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "OffsetCarryMQ201DrinkTray", "nombre": "Llevar una bandeja de bebidas", "categoria": "oficios", "andando": true, "descripcion": "Llevar una bandeja de bebidas. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "OffsetCarryMQ201DrinkR", "nombre": "Llevar una copa en la mano", "categoria": "oficios", "andando": true, "descripcion": "Llevar una copa en la mano. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "OffsetCarryPotStart", "nombre": "Llevar una olla", "categoria": "oficios", "andando": true, "descripcion": "Llevar una olla. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleDwemerExtractorEnter", "nombre": "Manejar un extractor", "categoria": "oficios", "descripcion": "Manejar un extractor."},
      {"evento": "IdlePickaxeEnter", "nombre": "Picar con el pico", "categoria": "oficios", "destacada": true, "descripcion": "Picar con el pico."},
      {"evento": "IdleCookingSpitEnter", "nombre": "Ponerse a cocinar en el asador", "categoria": "oficios", "descripcion": "Ponerse a cocinar en el asador. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleCookingPotEnter", "nombre": "Ponerse a cocinar en la olla", "categoria": "oficios", "descripcion": "Ponerse a cocinar en la olla. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleWriteLedgerChargenEnter", "nombre": "Ponerse a escribir en el registro", "categoria": "oficios", "descripcion": "Ponerse a escribir en el registro."},
      {"evento": "IdleAlchemyEnter", "nombre": "Ponerse a la mesa de alquimia", "categoria": "oficios", "descripcion": "Ponerse a la mesa de alquimia. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleEnchantingEnter", "nombre": "Ponerse a la mesa de encantamiento", "categoria": "oficios", "descripcion": "Ponerse a la mesa de encantamiento. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleHammerCarpenterTableEnter", "nombre": "Ponerse a martillear en el banco de carpintero", "categoria": "oficios", "descripcion": "Ponerse a martillear en el banco de carpintero. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleHammerTableEnter", "nombre": "Ponerse a martillear en la mesa", "categoria": "oficios", "descripcion": "Ponerse a martillear en la mesa. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleHammerWallEnter", "nombre": "Ponerse a martillear en la pared", "categoria": "oficios", "descripcion": "Ponerse a martillear en la pared."},
      {"evento": "IdleDLC2PickaxeEnter", "nombre": "Ponerse a picar con el pico", "categoria": "oficios", "descripcion": "Ponerse a picar con el pico."},
      {"evento": "IdlePickaxeFloorEnter", "nombre": "Ponerse a picar en el suelo", "categoria": "oficios", "descripcion": "Ponerse a picar en el suelo."},
      {"evento": "IdleDLC2PickaxeFloorEnter", "nombre": "Ponerse a picar en el suelo (Solstheim)", "categoria": "oficios", "descripcion": "Ponerse a picar en el suelo (Solstheim)."},
      {"evento": "IdlePickaxeTableEnter", "nombre": "Ponerse a picar en la mesa", "categoria": "oficios", "descripcion": "Ponerse a picar en la mesa. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleDLC2PickaxeTableEnter", "nombre": "Ponerse a picar en la mesa (Solstheim)", "categoria": "oficios", "descripcion": "Ponerse a picar en la mesa (Solstheim). Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleOvenEnter", "nombre": "Ponerse al horno", "categoria": "oficios", "descripcion": "Ponerse al horno. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleTanningEnter", "nombre": "Ponerse en el banco de curtido", "categoria": "oficios", "descripcion": "Ponerse en el banco de curtido. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleGrainMillEnter", "nombre": "Ponerse en el molino", "categoria": "oficios", "descripcion": "Ponerse en el molino. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleSmelterEnter", "nombre": "Ponerse en la fundición", "categoria": "oficios", "descripcion": "Ponerse en la fundición. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleCounterStart", "nombre": "Ponerse tras el mostrador", "categoria": "oficios", "descripcion": "Ponerse tras el mostrador. Necesita: estar en el mostrador o el mostrador."},
      {"evento": "IdleScrapeTreeBark", "nombre": "Raspar la corteza de un árbol", "categoria": "oficios", "descripcion": "Raspar la corteza de un árbol."},
      {"evento": "IdleSearchingChest", "nombre": "Rebuscando en el cofre", "categoria": "oficios", "descripcion": "Rebuscando en el cofre."},
      {"evento": "IdleSearchingTable", "nombre": "Rebuscando en la mesa", "categoria": "oficios", "descripcion": "Rebuscando en la mesa. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleSearchTableEnter", "nombre": "Rebuscar en la mesa", "categoria": "oficios", "descripcion": "Rebuscar en la mesa. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleSearchChestEnter", "nombre": "Rebuscar en un cofre", "categoria": "oficios", "descripcion": "Rebuscar en un cofre."},
      {"evento": "IdleActivatePickUp", "nombre": "Recoger algo", "categoria": "oficios", "descripcion": "Recoger algo. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdlePickup_Ground", "nombre": "Recoger algo del suelo", "categoria": "oficios", "descripcion": "Recoger algo del suelo."},
      {"evento": "IdleActivatePickUpLow", "nombre": "Recoger algo del suelo (1)", "categoria": "oficios", "descripcion": "Recoger algo del suelo (1). Necesita: necesita llevar el objeto en las manos."},
      {"evento": "OffsetCarryFlowerBasketPickStart", "nombre": "Recoger flores en el cesto", "categoria": "oficios", "andando": true, "descripcion": "Recoger flores en el cesto. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleWoodPickUpEnter", "nombre": "Recoger leña", "categoria": "oficios", "descripcion": "Recoger leña. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleRFPickUpScroll", "nombre": "Recoger un pergamino", "categoria": "oficios", "descripcion": "Recoger un pergamino. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleStonePickUpEnter", "nombre": "Recoger una piedra", "categoria": "oficios", "descripcion": "Recoger una piedra. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleWriteTableChairRightEnter", "nombre": "Sentarse a escribir por la derecha", "categoria": "oficios", "descripcion": "Sentarse a escribir por la derecha. Necesita: estar sentado en una silla, banco o taburete.", "visible": false},
      {"evento": "IdleWriteTableChairLeftEnter", "nombre": "Sentarse a escribir por la izquierda", "categoria": "oficios", "descripcion": "Sentarse a escribir por la izquierda. Necesita: estar sentado en una silla, banco o taburete.", "visible": false},
      {"evento": "IdleOffsetCarryPotServe", "nombre": "Servir de la olla", "categoria": "oficios", "andando": true, "descripcion": "Servir de la olla. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleLadderEnter", "nombre": "Subir por una escalera", "categoria": "oficios", "descripcion": "Subir por una escalera.", "visible": false},
      {"evento": "IdleCartTravelPlayerEnter", "nombre": "Subirse al carro", "categoria": "oficios", "descripcion": "Subirse al carro. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdleCartTravelDriverEnter", "nombre": "Subirse al pescante", "categoria": "oficios", "descripcion": "Subirse al pescante. Necesita: estar subido en el carro.", "visible": false},
      {"evento": "IdlePullChain", "nombre": "Tirar de la cadena", "categoria": "oficios", "descripcion": "Tirar de la cadena."},
      {"evento": "IdleBlackSmithingEnterStart", "nombre": "Trabajar en la forja", "categoria": "oficios", "destacada": true, "descripcion": "Trabajar en la forja. Necesita: estar delante de la mesa de trabajo."},
      {"evento": "IdleCarryBucketPourEnter", "nombre": "Vaciar una cubeta", "categoria": "oficios", "descripcion": "Vaciar una cubeta. Necesita: necesita llevar el objeto en las manos."},
      {"evento": "IdleSell", "nombre": "Vender algo", "categoria": "oficios", "descripcion": "Vender algo."},
      {"evento": "pa_OffsetBoundStandingCut", "nombre": "Cortar las ataduras (A ti)", "categoria": "remates", "descripcion": "Se cortan las ataduras de las manos por alguien más (hace un pequeño movimiento de manos como que alguien le corta la atadura de las manos)", "visible": false},
      {"evento": "ExecutionNextClip", "nombre": "Ejecución: siguiente parte", "categoria": "remates", "descripcion": "Siguiente paso de la animación de ejecución", "visible": false},
      {"evento": "pa_KillingBlow", "nombre": "Golpe de gracia", "categoria": "remates", "descripcion": "Toma su espada de una mano y la clava rematando", "visible": false},
      {"evento": "pa_2HWKillMoveA", "nombre": "Rematar", "categoria": "remates", "descripcion": "No funciona", "visible": false},
      {"evento": "pa_KillMoveB", "nombre": "Rematar (12)", "categoria": "remates", "descripcion": "Rematar (12). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove", "nombre": "Rematar (13)", "categoria": "remates", "descripcion": "Rematar (13). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveI", "nombre": "Rematar (2)", "categoria": "remates", "descripcion": "Rematar (2). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveE", "nombre": "Rematar (3)", "categoria": "remates", "descripcion": "Rematar (3). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveM", "nombre": "Rematar (5)", "categoria": "remates", "descripcion": "Rematar (5). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveL", "nombre": "Rematar (6)", "categoria": "remates", "descripcion": "Rematar (6). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveK", "nombre": "Rematar (7)", "categoria": "remates", "descripcion": "Rematar (7). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveH", "nombre": "Rematar (8)", "categoria": "remates", "descripcion": "Rematar (8). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveG", "nombre": "Rematar (9)", "categoria": "remates", "descripcion": "Rematar (9). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveSneakBackA", "nombre": "Rematar a hurtadillas y degollado (Una mano)", "categoria": "remates", "descripcion": "Remata agarrando y degollando", "visible": false},
      {"evento": "pa_KillMoveH2HComboA", "nombre": "Rematar a puñetazos (Puños)", "categoria": "remates", "confirmado": false, "descripcion": "Remata agarrando y golpeando con los puños", "visible": false},
      {"evento": "pa_KillMove1HMGrappleStab", "nombre": "Rematar agarrando y apuñalando con un arma de una mano", "categoria": "remates", "descripcion": "Rematar agarrando y apuñalando con un arma de una mano. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove2HMStabA", "nombre": "Rematar apuñalada (Dos manos)", "categoria": "remates", "descripcion": "Remata apuñalando en el centro hacia arriba con dos manos", "visible": false},
      {"evento": "pa_KillMove2HMChaurusFlyerStabDown", "nombre": "Rematar apuñalada baja (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata preparando el arma y apuñalando hacia abajo dos manos", "visible": false},
      {"evento": "pa_KillMove1HMSpiderStabA", "nombre": "Rematar apuñalada baja (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata apuñalando hacia abajo con una mano", "visible": false},
      {"evento": "pa_KillMove1HMStabDownChest", "nombre": "Rematar apuñalando en el pecho con un arma de una mano", "categoria": "remates", "descripcion": "Rematar apuñalando en el pecho con un arma de una mano. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove1HMStabUpFace", "nombre": "Rematar apuñalando en la cara con un arma de una mano", "categoria": "remates", "descripcion": "Rematar apuñalando en la cara con un arma de una mano. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove1HMRepeatStabDown", "nombre": "Rematar apuñalando varias veces con un arma de una mano", "categoria": "remates", "descripcion": "Rematar apuñalando varias veces con un arma de una mano. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove1HMBackStab", "nombre": "Rematar apuñalar por la espalda (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata agarrando y apuñalando", "visible": false},
      {"evento": "pa_KillMoveDLC02RipHeartOut", "nombre": "Rematar arrancando corazón", "categoria": "remates", "descripcion": "Remata agarrandolo en el aire y arrancando el corazón", "visible": false},
      {"evento": "pa_KillMoveC", "nombre": "Rematar cargando (Una mano)", "categoria": "remates", "descripcion": "Remata cargando al enemigo hacia atrás y lo remata con espada", "visible": false},
      {"evento": "pa_KillMove2HMFalmerA", "nombre": "Rematar clavando desde abajo (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata clavando el arma desde abajo", "visible": false},
      {"evento": "pa_KillMove2HMWolfA", "nombre": "Rematar clavando desde abajo 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata clavando el arma desde abajo", "visible": false},
      {"evento": "pa_KillMove1HMFalmerA", "nombre": "Rematar con agarre (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata agarrando y haciendo un tajo horizontal arriba", "visible": false},
      {"evento": "pa_KillMove1HMHagravenB", "nombre": "Rematar con agarre 2 (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata agarrando y dando un tjao horizontal", "visible": false},
      {"evento": "pa_KillMoveF", "nombre": "Rematar con altura (Una mano)", "categoria": "remates", "descripcion": "Remata cargando hacia adelante y subirse para rematar", "visible": false},
      {"evento": "pa_KillMove2HMSteamCenturionA", "nombre": "Rematar con dificultad (Dos manos) (1)", "categoria": "remates", "confirmado": false, "descripcion": "Remata tajando arriba horizontalmente, pero se queda atascado", "visible": false},
      {"evento": "pa_KillMove2HWVBBackBreaker", "nombre": "Rematar con dificultad (Dos manos) (2)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dificultad con dos golpes", "visible": false},
      {"evento": "pa_KillMove2HMVBBlockAndSlash", "nombre": "Rematar con doble bloqueo (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata bloqueando dos veces y luego tajando", "visible": false},
      {"evento": "pa_KillMove2HWWolfA", "nombre": "Rematar con doble golpe (Dos manos) (1)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dos golpes", "visible": false},
      {"evento": "pa_KillMove2HWTrollA", "nombre": "Rematar con doble golpe (Dos manos) (2)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dos golpes", "visible": false},
      {"evento": "pa_KillMove2HMWolfB", "nombre": "Rematar con doble tajo (Dos manos) (1)", "categoria": "remates", "confirmado": false, "descripcion": "Remata tajando 2 veces", "visible": false},
      {"evento": "pa_KillMove2HMTrollB", "nombre": "Rematar con doble tajo (Dos manos) (2)", "categoria": "remates", "confirmado": false, "descripcion": "Remata tajando 2 veces", "visible": false},
      {"evento": "pa_KillMove1HMTrollB", "nombre": "Rematar con doble tajo (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dos tajos rapidos", "visible": false},
      {"evento": "pa_KillMove1HMHagravenA", "nombre": "Rematar con doble tajo 2 (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dos tajos rapidos", "visible": false},
      {"evento": "pa_KillMove1HMSteamCenturionB", "nombre": "Rematar con doble tajo lento (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con dos tajos lentos", "visible": false},
      {"evento": "pa_KillMoveDualWieldA", "nombre": "Rematar con dos armas (Una mano Doble)", "categoria": "remates", "descripcion": "Remata perforando desde abajo con las dos armas de una mano", "visible": false},
      {"evento": "pa_KillMove2HMSprigganA", "nombre": "Rematar con estilo (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un salto y tajo hacia abajo", "visible": false},
      {"evento": "pa_KillMoveD", "nombre": "Rematar con estilo (Una mano)", "categoria": "remates", "descripcion": "Remata con un salto y tajo hacia adelante", "visible": false},
      {"evento": "pa_KillMove2HMHagravenA", "nombre": "Rematar con estilo 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un salto y tajo hacia abajo", "visible": false},
      {"evento": "pa_KillMoveBearA", "nombre": "Rematar con fuerza (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo 2 tajos, el último en el centro", "visible": false},
      {"evento": "pa_KillMoveShortA", "nombre": "Rematar con fuerza desde abajo (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo un corte diagonal desde abajo hacia arriba", "visible": false},
      {"evento": "pa_KillMoveSabreCatShortB", "nombre": "Rematar con fuerza desde arriba (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo un corte diagonal desde arriba pero se queda atascado", "visible": false},
      {"evento": "pa_KillMove1HMWolfA", "nombre": "Rematar con golpe (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un golpe contundente", "visible": false},
      {"evento": "pa_KillMove1HMVBSoccerKick", "nombre": "Rematar con patada (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un tajo alto y patada de Rematar", "visible": false},
      {"evento": "pa_KillMove1HMWolfB", "nombre": "Rematar con patada y tajo (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una patada y luego un tajo vertical", "visible": false},
      {"evento": "pa_KillMove1HMSprigganB", "nombre": "Rematar con perforante superior (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata perforando desde arriba hacia abajo", "visible": false},
      {"evento": "pa_KillMoveJ", "nombre": "Rematar con pierna", "categoria": "remates", "descripcion": "Remata aplastando lo que está en el suelo", "visible": false},
      {"evento": "pa_KillMove2HWSprigganA", "nombre": "Rematar con salto y golpe (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un salto y golpe tajante vertical", "visible": false},
      {"evento": "pa_KillMove2HMSpiderSlamA", "nombre": "Rematar con salto y tajo (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un salto y cae tajando", "visible": false},
      {"evento": "pa_KillMove2HWSpiderSlamA", "nombre": "Rematar con salto y tajo 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con un salto y cae tajando", "visible": false},
      {"evento": "pa_KillMove1HMFalmerB", "nombre": "Rematar con tajo doble (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con 2 tajos rapidos", "visible": false},
      {"evento": "pa_KillMove1HMFalmerC", "nombre": "Rematar con tajo fuerte (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo que se queda atascado", "visible": false},
      {"evento": "pa_KillMove1HMBearB", "nombre": "Rematar con tajo fuerte 2 (Una mano)", "categoria": "remates", "descripcion": "Remata dando un tajo que se queda atascado", "visible": false},
      {"evento": "pa_KillMoveDraugrShortA", "nombre": "Rematar con un golpe (Una mano)", "categoria": "remates", "descripcion": "Remata golpeando con el arma contundentemente", "visible": false},
      {"evento": "pa_KillMove1HMChaurusFlyerKick", "nombre": "Rematar con una patada", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una patada fuerte", "visible": false},
      {"evento": "pa_KillMove1HMSprigganA", "nombre": "Rematar con voltereta y tajo vertical (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una vuelta a la izquierda y tajando verticalmente", "visible": false},
      {"evento": "pa_KillMove2HMBearB", "nombre": "Rematar con vuelta (Dos manos)", "categoria": "remates", "descripcion": "Remata dando una vuelta y tajando horizontalmente", "visible": false},
      {"evento": "pa_KillMove2HMSabreCatB", "nombre": "Rematar con vuelta 2 (Dos manos)", "categoria": "remates", "descripcion": "Remata dando una vuelta y tajando horizontalmente", "visible": false},
      {"evento": "pa_KillMove2HMGiantA", "nombre": "Rematar con vuelta 3 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una vuelta y tajando horizontalmente", "visible": false},
      {"evento": "pa_KillMove1HMDecap", "nombre": "Rematar con vuelta y decapitando (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una vuelta y decapitando", "visible": false},
      {"evento": "pa_KillMove2HWSabreCatA", "nombre": "Rematar con vuelta y golpe al centro (Dos manos)", "categoria": "remates", "descripcion": "Remata con una vuelta y golpe en el centro", "visible": false},
      {"evento": "pa_KillMove2HWGiantA", "nombre": "Rematar con vuelta y golpe al centro 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con una vuelta y golpe en el centro", "visible": false},
      {"evento": "pa_KillMove2HWBearA", "nombre": "Rematar con vuelta y golpe al centro 3 (Dos manos)", "categoria": "remates", "descripcion": "Remata con una vuelta y golpe en el centro", "visible": false},
      {"evento": "pa_KillMove1HMSteamCenturionA", "nombre": "Rematar con vuelta y tajo (Una mano) (1)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con una vuelt ay tajo alto horizontal que se traba", "visible": false},
      {"evento": "pa_KillMove1HMGiantBleedOutA", "nombre": "Rematar con vuelta y tajo (Una mano) (2)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una vuelta y tajando verticalmente", "visible": false},
      {"evento": "pa_KillMove1HMGiantB", "nombre": "Rematar con vuelta y tajo hacia arriba (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando una vuelta y haciendo un pequeño salto para tajar arriba", "visible": false},
      {"evento": "pa_KillMoveGiantA", "nombre": "Rematar cortando y punzando arriba (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata cortando en horizontal y posteriormente punzar hacia arriba", "visible": false},
      {"evento": "pa_KillMove1HMDecapBleedOut", "nombre": "Rematar corte circular bajo (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata haciendo un movimiento circular hacia abajo", "visible": false},
      {"evento": "pa_KillMove2HM3Slash", "nombre": "Rematar de tres tajos con un arma a dos manos", "categoria": "remates", "descripcion": "Rematar de tres tajos con un arma a dos manos. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveDWDualSlash", "nombre": "Rematar de un tajo con las dos armas", "categoria": "remates", "descripcion": "Rematar de un tajo con las dos armas. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove2HMSlash", "nombre": "Rematar de un tajo con un arma a dos manos", "categoria": "remates", "descripcion": "Rematar de un tajo con un arma a dos manos. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove2HWChaurusFlyerPullDownSlash", "nombre": "Rematar debilitando y golpe (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata de forma pezada con un primer golpe y otro fulminante", "visible": false},
      {"evento": "pa_KillMove2HMDecapBleedOut", "nombre": "Rematar decapitando (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata decapitando lo que haya debilitado en el suelo", "visible": false},
      {"evento": "pa_KillMoveDWDecap", "nombre": "Rematar decapitando (Una mano Doble)", "categoria": "remates", "confirmado": false, "descripcion": "Remata decapitando con dos armas de una mano", "visible": false},
      {"evento": "pa_KillMove2HMDecap", "nombre": "Rematar decapitando 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata decapitando lo que haya debilitado en el suelo", "visible": false},
      {"evento": "pa_KillMove2HWDecapBleedOut", "nombre": "Rematar decapitando fuertemente (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata decapitando lo que haya debilitado en el suelo", "visible": false},
      {"evento": "pa_KillMove1HMDecapKnife", "nombre": "Rematar degollando con cuchillo", "categoria": "remates", "confirmado": false, "descripcion": "Remata degollando con el cuchillo", "visible": false},
      {"evento": "pa_KillMoveShortB", "nombre": "Rematar desde abajo (Una mano)", "categoria": "remates", "descripcion": "Remata perforando desde abajo hacia arriba", "visible": false},
      {"evento": "pa_KillMoveShortD", "nombre": "Rematar desde arriba (Una mano)", "categoria": "remates", "descripcion": "Remata perforando desde arriba hacia abajo", "visible": false},
      {"evento": "pa_KillMoveDraugrShortB", "nombre": "Rematar en corto (7)", "categoria": "remates", "descripcion": "Rematar en corto (7). Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveDWXSlash", "nombre": "Rematar en cruz con las dos armas", "categoria": "remates", "descripcion": "Rematar en cruz con las dos armas. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveSabreCatShortA", "nombre": "Rematar en el suelo (Una mano)", "categoria": "remates", "descripcion": "Remata perforando desde arriba hacia abajo", "visible": false},
      {"evento": "pa_KillMoveH2HSneakSleeper", "nombre": "Rematar estrangulando por sorpresa", "categoria": "remates", "descripcion": "Rematar estrangulando por sorpresa. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveH2HSlamA", "nombre": "Rematar estrellando al suelo (Puños)", "categoria": "remates", "descripcion": "Remata cargando y estrellandolo al suelo", "visible": false},
      {"evento": "pa_KillMoveH2HBodySlam", "nombre": "Rematar estrellándolo contra el suelo", "categoria": "remates", "descripcion": "Rematar estrellándolo contra el suelo. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMoveDraugrB", "nombre": "Rematar girando (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo una rotación 360 grados", "visible": false},
      {"evento": "pa_KillMoveTrollA", "nombre": "Rematar hacia arriba (Una mano)", "categoria": "remates", "descripcion": "Remata agarrando y cortando hacia arriba horizontalmente", "visible": false},
      {"evento": "pa_KillMoveSabreCat", "nombre": "Rematar hacia la izquierda (Una mano)", "categoria": "remates", "descripcion": "Remata hacia la izquierda perforando con nuestra arma", "visible": false},
      {"evento": "pa_KillMove1HMVBSlowBackStab", "nombre": "Rematar largo (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata apuñalando y luego corte de garganta", "visible": false},
      {"evento": "pa_KillMoveH2HSneakNeckBreak", "nombre": "Rematar partiendo el cuello por sorpresa", "categoria": "remates", "descripcion": "Rematar partiendo el cuello por sorpresa. Es una ejecución: el juego la lanza al rematar a un enemigo, con la cámara y el enemigo ya colocados.", "visible": false},
      {"evento": "pa_KillMove2HMBearA", "nombre": "Rematar perforante (Dos manos)", "categoria": "remates", "descripcion": "Remata perforando en el centro el arma", "visible": false},
      {"evento": "pa_KillMove2HMSabreCatA", "nombre": "Rematar perforante 2 (Dos manos)", "categoria": "remates", "descripcion": "Remata perforando en el centro el arma", "visible": false},
      {"evento": "pa_KillMove2HMTrollA", "nombre": "Rematar perforante 3 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata perforando en el centro el arma", "visible": false},
      {"evento": "pa_KillMoveDraugr", "nombre": "Rematar repetidamente (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo 3 tajos diagonales", "visible": false},
      {"evento": "pa_KillMove1HMSpiderSmashA", "nombre": "Rematar sencillo (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata con impacto rápido en el suelo", "visible": false},
      {"evento": "pa_KillMoveShortC", "nombre": "Rematar tajando desde arriba (Una mano)", "categoria": "remates", "descripcion": "Remata haciendo un tajo verticalmente", "visible": false},
      {"evento": "pa_KillMove2HMDraugrA", "nombre": "Rematar tajante doble (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata tajano dos veces", "visible": false},
      {"evento": "pa_KillMove2HMFalmerB", "nombre": "Rematar tajante doble 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata tajano dos veces", "visible": false},
      {"evento": "pa_KillMove2HWDragonRodeoSlash", "nombre": "Rematar tajo y montarse (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo y se sube en algo grande", "visible": false},
      {"evento": "pa_KillMove1HMDragonRodeoStabShort", "nombre": "Rematar tajo y montarse (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo y se sube en algo grande", "visible": false},
      {"evento": "pa_KillMove2HMDragonSlash", "nombre": "Rematar tajo y montarse 2 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo y se sube en algo grande", "visible": false},
      {"evento": "pa_KillMove1HMDragonRodeoSlash", "nombre": "Rematar tajo y montarse 2 (Una mano)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo y se sube en algo grande", "visible": false},
      {"evento": "pa_KillMove2HWDragonSlash", "nombre": "Rematar tajo y montarse 3 (Dos manos)", "categoria": "remates", "confirmado": false, "descripcion": "Remata dando un tajo y se sube en algo grande", "visible": false},
      {"evento": "pa_DLC1SeranaHoldsVyrthur", "nombre": "Sujetar a alguien y soltarlo", "categoria": "remates", "descripcion": "Levantar a alguien para despues de unos segundos soltarlo", "visible": false},
      {"evento": "IdleBarCounterEnter", "nombre": "Apoyarse en el mostrador", "categoria": "sentarse", "descripcion": "Apoya en el mostrador de bar, a veces limpia"},
      {"evento": "IdleRailLeanEnter", "nombre": "Apoyarse en la baranda", "categoria": "sentarse", "destacada": true, "descripcion": "Avanza un poco y apoyate en la baranda"},
      {"evento": "IdleLeanTableEnter", "nombre": "Apoyarse en la mesa", "categoria": "sentarse", "descripcion": "Apoyarse en la mesa. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleTableLeanPoint", "nombre": "Apoyarse en la mesa y señalar", "categoria": "sentarse", "descripcion": "Apoyarse en la mesa para señalar", "visible": false},
      {"evento": "IdleWallLeanStart", "nombre": "Apoyarse en la pared", "categoria": "sentarse", "destacada": true, "descripcion": "Voltea y te apoyas con brazos cruzados"},
      {"evento": "IdleChildSitOnKnees", "nombre": "Arrodillarse (2)", "categoria": "sentarse", "descripcion": "Sentarse sobre las rodillas y hace un pequeño balanceo"},
      {"evento": "idleChairArmsCrossedVar1", "nombre": "Brazos cruzados (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Cruzar los brazos mientras estás sentado en una silla"},
      {"evento": "idleChairArmsCrossedVar2", "nombre": "Brazos cruzados 2 (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Cruzar los brazos mientras estás sentado en una silla"},
      {"evento": "IdleChairVar1", "nombre": "Cambio de pose (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Pose de estar centado"},
      {"evento": "idleChairVar2", "nombre": "Cambio de pose 2 (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Pose de estar centado"},
      {"evento": "IdleRailLeanExit", "nombre": "Dejar de apoyarse en la baranda", "categoria": "sentarse", "descripcion": "Retrocede un poco y sale de apoyate en la baranda"},
      {"evento": "IdleLounge_Exit", "nombre": "Dejar de repantigarse", "categoria": "sentarse", "descripcion": "Bajarse de mueble alto.", "visible": false},
      {"evento": "IdleHideLEnter", "nombre": "Esconderse contra la pared", "categoria": "sentarse", "descripcion": "Esconderse contra la pared."},
      {"evento": "IdleWallSoldierEnter", "nombre": "Esperar atento", "categoria": "sentarse", "descripcion": "Quedarse quieto esperando con diferentes poses intercaladas"},
      {"evento": "idleChairShoulderFlex", "nombre": "Estirarse (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Estirar los brazos mientras estás sentado en una silla"},
      {"evento": "IdleChairFrontExit", "nombre": "Levantarse de frente", "categoria": "sentarse", "descripcion": "Levantarse de la silla de frente", "visible": false},
      {"evento": "IdleChairFrontQuickExit", "nombre": "Levantarse de frente, rápido", "categoria": "sentarse", "descripcion": "Levantarse de la silla de frente rapido", "visible": false},
      {"evento": "IdleTableBackExit", "nombre": "Levantarse de la mesa", "categoria": "sentarse", "descripcion": "Levantarse de mesa hacia atras", "visible": false},
      {"evento": "IdleChairExitStart", "nombre": "Levantarse de la silla", "categoria": "sentarse", "descripcion": "Levantarse de la silla de lado", "visible": false},
      {"evento": "IdleStoolBackExit", "nombre": "Levantarse del taburete", "categoria": "sentarse", "descripcion": "Levantarse de taburete de bar", "visible": false},
      {"evento": "idleChairRightExit", "nombre": "Levantarse por la derecha", "categoria": "sentarse", "descripcion": "Levantarse de la silla del lado derecho", "visible": false},
      {"evento": "IdleChairRightQuickExit", "nombre": "Levantarse por la derecha, rápido", "categoria": "sentarse", "descripcion": "Levantarse de la silla del lado derecho rapido", "visible": false},
      {"evento": "idleChairLeftExit", "nombre": "Levantarse por la izquierda", "categoria": "sentarse", "descripcion": "Levantarse de la silla del lado izquierdo", "visible": false},
      {"evento": "IdleChairLeftQuickExit", "nombre": "Levantarse por la izquierda, rápido", "categoria": "sentarse", "descripcion": "Levantarse de la silla del lado izquierdo rapido", "visible": false},
      {"evento": "idleChairLookDown", "nombre": "Mirar al suelo (Sentado)", "categoria": "sentarse", "sentado": true, "descripcion": "Mirar alrededor y luego mirar al suelo mientras estás sentado en una silla"},
      {"evento": "IdleLounge", "nombre": "Repantigarse", "categoria": "sentarse", "destacada": true, "descripcion": "Subirse a mueble alto", "visible": false},
      {"evento": "IdleTableEnter", "nombre": "Sentarse a la mesa", "categoria": "sentarse", "descripcion": "Sentarse a la mesa. Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleTableEnterPlayer", "nombre": "Sentarse a la mesa (jugador)", "categoria": "sentarse", "descripcion": "Sentarse a la mesa (jugador). Necesita: estar delante de la mesa de trabajo.", "visible": false},
      {"evento": "IdleSitCrossLeggedEnter", "nombre": "Sentarse con las piernas cruzadas", "categoria": "sentarse", "descripcion": "Sentarse con las piernas cruzadas. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleChildLegsOutStart", "nombre": "Sentarse con las piernas estiradas", "categoria": "sentarse", "descripcion": "Sentarse con piernas cruzadas", "visible": false},
      {"evento": "IdleChairFrontEnter", "nombre": "Sentarse de frente", "categoria": "sentarse", "destacada": true, "descripcion": "Sentarse de frente en silla", "visible": false},
      {"evento": "IdleStoolEnter", "nombre": "Sentarse en el taburete", "categoria": "sentarse", "destacada": true, "descripcion": "Sentarse en taburete de bar", "visible": false},
      {"evento": "IdleStoolEnterPlayer", "nombre": "Sentarse en el taburete (jugador)", "categoria": "sentarse", "descripcion": "Sentarse en el taburete (jugador). Necesita: estar sentado en una silla, banco o taburete.", "visible": false},
      {"evento": "IdleJarlChairEnter", "nombre": "Sentarse en el trono del jarl", "categoria": "sentarse", "descripcion": "Sentarse en trono de jarl", "visible": false},
      {"evento": "IdleSnowElfPrinceChairEnter", "nombre": "Sentarse en el trono élfico", "categoria": "sentarse", "descripcion": "Sentarse en el trono élfico. Necesita: estar sentado en una silla, banco o taburete.", "visible": false},
      {"evento": "IdleSitLedgeEnter", "nombre": "Sentarse en una repisa", "categoria": "sentarse", "descripcion": "Sentarse en una repisa. Necesita: estar sentado en una silla, banco o taburete."},
      {"evento": "IdleChairRightEnter", "nombre": "Sentarse por la derecha", "categoria": "sentarse", "descripcion": "Sentarse por la derecha en silla", "visible": false},
      {"evento": "IdleChairLeftEnter", "nombre": "Sentarse por la izquierda", "categoria": "sentarse", "descripcion": "Sentarse por la izquierda en silla", "visible": false}
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
        /* Lo que hace, en una linea. Se escribe en la hoja de revision y sale
           en la ficha que asoma al pasar el raton por la lista. Sin esto el
           panel recibia las animaciones sin descripcion y la ficha salia
           siempre con "Sin descripcion", aunque estuviera escrita. */
        descripcion: ficha.descripcion || '',
        /* Se ve o no se ve. Por ahora todas se ven; el servidor podra esconder
           las que quiera, por jugador, con ap.ocultar(). Ver pedirOcultar. */
        visible: ficha.visible === false ? false : true,
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

  /* Si tenemos la postura del arma forzada con setWeaponDrawnMode.
   *
   * Hace falta llevar la cuenta porque el forzado es para el corte y SOLO para
   * el corte: una pose reproducida con la postura forzada sale a medias —el
   * personaje baja las manos con el arma en ellas—, y soltar el forzado en
   * mitad de una pose la rompe. Asi que se suelta antes de lanzar cualquier
   * cosa, y para eso hay que saber si estaba puesto. */
  var armaForzada = false;

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
    /**
     * Corta la pose. Con la memoria del estado, si la hay, respeta lo que ya
     * tenias: ver mirarElEstado.
     */
    parar: function (peticion, memoria) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;

      /* EL CORTE, Y POR QUE NO ES IdleForceDefaultState.
       *
       * En los registros del propio juego, el IDLE cuyo evento es
       * IdleForceDefaultState tiene por editorId "ResetRoot". No para la
       * animacion: devuelve la raiz del grafo a su estado por defecto, que es
       * de pie, con las manos vacias y fuera de cualquier mueble. Por eso se
       * llevaba por delante todo lo que la pose tenia debajo —la guardia, la
       * silla—: es literalmente lo que ese evento hace.
       *
       * IdleStop si para una animacion sin tocar el resto, y existe de verdad
       * (20 registros en los ESM). Es el que se manda ahora.
       *
       * OJO con el consejo que circula por los foros: PlayIdle(IdleStop_Loose).
       * IdleStop_Loose no es un evento, es el editorId de un registro cuyo
       * EVENTO se llama IdleStop. PlayIdle recibe el registro y
       * sendAnimationEvent el nombre del evento, asi que mandar
       * "IdleStop_Loose" por aqui no haria nada. Y sin dar error, que es lo
       * peor que puede pasar con un evento de animacion. */
      var reseteaLaRaiz = (EVENTO_DE_PARADA === 'IdleForceDefaultState');

      /* El forzado del arma va atado al reseteo, que es el unico corte que la
         baja. Con IdleStop no hace falta, y mejor: era la causa de que la pose
         siguiente saliera con la postura forzada. */
      if (reseteaLaRaiz && memoria && memoria.armaFuera) {
        Reproductor.mantenerElArmaFuera(actor);
      } else {
        // Por si el bloqueo del arma se quedo puesto: soltarlo no cuesta nada.
        Reproductor.soltarElArma(actor);
      }

      /* SI ESTAS EN UN MUEBLE, NO SE MANDA EL LEVANTARSE. Punto.

         Lo decide el estado de ahora —getFurnitureReference— y no la memoria ni
         una lista de animaciones. Estando sentado, levantarte nunca es lo que
         querias al pulsar algo; y si de verdad hay que salir de ahi, para eso
         esta Reiniciar.

         Se mira el estado y no el recuerdo porque las dos cosas se despegan: si
         la pose te saco de la silla, creerse el recuerdo dejaba el corte a
         medias sin razon. Estando ya de pie, mandar el levantarse no hace daño
         —no te levanta de la nada— y el corte sale entero; despues, si se
         recordaba un mueble, el plan B te vuelve a sentar. */
      var enUnMueble = Reproductor.enUnMueble(peticion);

      /* LOS CINCO EVENTOS DEL CORTE.
       *
       * Salen de leer el grafo del personaje y quedarse con los genericos de
       * parar, los que no van atados a una animacion concreta. Antes se
       * mandaban tres y faltaban dos, y por eso habia poses que no se
       * detenian:
       *
       *   OffsetStop       la pose que va encima de la postura
       *   IdleOffsetStop   su variante para los idles de tipo offset
       *   AnimObjectStop   lo que el juego te engancha a la mano: la copa del
       *                    brindis, la jarra, el libro. Sin esto el objeto se
       *                    queda puesto y con el la animacion que lo sostiene.
       *   IdleStop         y el idle en si
       *
       * Los que no vienen al caso no hacen nada: el grafo ignora lo que no
       * puede atender desde donde esta. */
      try {
        enviarAlGrafo(actor, 'OffsetStop');
        enviarAlGrafo(actor, 'IdleOffsetStop');
        enviarAlGrafo(actor, 'AnimObjectStop');
        if (!enUnMueble) {
          enviarAlGrafo(actor, 'IdleFurnitureExit');
        }
        enviarAlGrafo(actor, EVENTO_DE_PARADA);

        /* A POR TODAS, si es la segunda vez seguida que pulsas Detener.
         *
         * Quedan animaciones que solo se sueltan reseteando la raiz, porque
         * meten al personaje en un sub-grafo sin salida propia. Eso es brusco
         * —te pone de pie, con las manos vacias y fuera del mueble— y no puede
         * ser lo que pase al pulsar una vez. Pero si acabas de pulsar y
         * vuelves a pulsar, lo que estas diciendo es que lo de antes no
         * funciono. */
        if (peticion && peticion.insistiendo) {
          enviarAlGrafo(actor, 'IdleStopInstant');
          enviarAlGrafo(actor, 'IdleForceDefaultState');
          apuntar('insistiendo: corte a por todas');
        }

        apuntar('animacion parada con ' + EVENTO_DE_PARADA);
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

    /** Manda el evento al juego. Lo unico que hace antes es soltar el arma. */
    mandar: function (peticion) {
      var actor = Reproductor.actorDe(peticion);
      if (!actor) return false;

      /* NINGUNA POSE SE REPRODUCE CON LA POSTURA DEL ARMA FORZADA.
       *
       * El forzado lo pone el corte, para que no te baje el arma (ver parar).
       * Si la pose siguiente llega antes de que se suelte, sale a medias: el
       * personaje baja las manos con el arma en ellas. Aqui es el unico sitio
       * por el que pasan todas —el bucle, el relevo y la puerta de otros mods
       * incluidos—, asi que aqui no hay forma de colarse. */
      if (armaForzada) {
        Reproductor.soltarElArma(actor);
        apuntar('soltado el forzado del arma antes de la pose');
      }

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
      armaForzada = false;
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

    /**
     * Suelta lo que el personaje lleve en las manos, y nada mas.
     *
     * Es el primer evento del corte, suelto: hay animaciones que sacan ollas,
     * jarras, libros o espadas de utileria, y si no se manda esto se quedan
     * puestas sobre la pose siguiente. Vale por si solo cuando NO se quiere
     * cortar nada mas —estando sentado, por ejemplo—.
     */
    soltarLasManos: function (peticion) {
      try {
        var actor = Reproductor.actorDe(peticion);
        if (!actor) return false;
        enviarAlGrafo(actor, 'OffsetStop');
        return true;
      } catch (e) {
        apuntar('no pude soltar las manos: ' + e);
        return false;
      }
    },

    /**
     * La foto del estado del que dependen las poses, antes de tocar nada.
     *
     * Dos cosas, que son las que el corte rompe:
     *
     *   armaFuera  si estabas en guardia. Hay poses que solo tienen sentido
     *              asi, y el corte las devolvia a manos vacias.
     *   mueble     la silla, banco o cama en la que estabas. Se guarda la
     *              REFERENCIA y no un si/no, porque con ella se puede volver a
     *              sentar si hiciera falta.
     */
    mirarElEstado: function (peticion) {
      var foto = { armaFuera: false, mueble: null };
      try {
        var actor = Reproductor.actorDe(peticion);
        if (!actor) return foto;
        foto.armaFuera = !!actor.isWeaponDrawn();
        foto.mueble = actor.getFurnitureReference() || null;
      } catch (e) {
        apuntar('no pude mirar el estado: ' + e);
      }
      return foto;
    },

    /**
     * Fuerza el arma fuera, para que el corte no la baje.
     *
     * Es la misma funcion que envainaba —setWeaponDrawnMode— con el otro modo.
     * Se eligio esa y no Actor.drawWeapon() por lo que ya se aprendio con el
     * envainado: de esa familia, sheatheWeapon() no hacia nada util en el juego
     * y setWeaponDrawnMode(0) si. Si en el juego resulta que la otra va mejor,
     * se cambia aqui y en ningun otro sitio.
     *
     * OJO: forzado no podrias envainar tu. El forzado se suelta poco despues,
     * con soltarElArma (ver pedirParar).
     */
    mantenerElArmaFuera: function (actor) {
      try {
        sp.TESModPlatform.setWeaponDrawnMode(actor, 1);
        armaForzada = true;
        return true;
      } catch (e) {
        apuntar('no pude mantener el arma fuera: ' + e);
        return false;
      }
    },

    /**
     * Plan B del mueble: si el corte te levanto igual, vuelve a sentarte.
     *
     * Activar la silla es lo que hace el juego cuando te sientas tu. Solo se
     * hace si NO estas ya metido en un mueble: activarla estando sentado te
     * levantaria, que es lo contrario de lo que se quiere.
     */
    volverAlMueble: function (actor, mueble) {
      try {
        if (!mueble) return false;
        if (actor.getFurnitureReference()) return false;   // ya estas sentado
        mueble.activate(actor, false);
        apuntar('vuelto al mueble');
        return true;
      } catch (e) {
        apuntar('no pude volver al mueble: ' + e);
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

  /* El estado en el que estabas antes de la primera pose, o null.
     Se toma al pasar de nada a algo, se consume al detener, y se tira al
     reiniciar o cuando la pose se da por terminada sola. */
  var memoriaDelEstado = null;

  /* Lo que queda por reponer cuando pase su momento, o null. Reponer no puede
     ser en el mismo cuadro que el corte: el corte es a su vez una transicion de
     animacion y se lleva por delante lo que le llegue encima. */
  var esperandoReponer = null;

  /**
   * Termina de devolverte al estado de antes, pasado el momento del corte.
   *
   * Dos cosas, y las dos pueden no hacer nada:
   *
   *   - soltar el forzado del arma. Se forzo antes del corte para que no te la
   *     bajara; dejarlo forzado te impediria envainar tu.
   *   - volver al mueble, solo si el corte te levanto de todas formas.
   */
  function vigilarLaReposicion() {
    if (!esperandoReponer) return;
    if (Date.now() < esperandoReponer.cuando) return;
    rematarLaReposicion(true);
  }

  /**
   * Hace ya lo que quedaba por reponer.
   *
   * conMueble dice si se vuelve a sentar. Cuando esto se remata porque llega una
   * pose nueva, NO: la pose manda, y sentarte en ese momento se pelearia con
   * ella. Soltar el arma si, siempre: el forzado dejado puesto no se va solo y
   * te quedarias sin poder envainar.
   */
  function rematarLaReposicion(conMueble) {
    if (!esperandoReponer) return;
    var lo = esperandoReponer;
    esperandoReponer = null;

    var actor = Reproductor.actorDe(lo.peticion);
    if (!actor) return;

    if (lo.memoria.armaFuera) Reproductor.soltarElArma(actor);
    if (conMueble && VOLVER_A_SENTARSE && lo.memoria.mueble) {
      Reproductor.volverAlMueble(actor, lo.memoria.mueble);
    }
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

    /* Si quedaba algo por reponer del corte anterior, se remata AHORA y no
       cuando le tocaba: dejarlo programado lo hacia caer en mitad de la pose
       que se esta pidiendo, y soltar el forzado del arma ahi la rompe. Sin el
       mueble, que de eso ya se encarga la pose nueva. */
    if (limpia.origen !== 'bucle') rematarLaReposicion(false);

    /* La foto del estado, al pasar de NADA a algo.
     *
     * No en cada relevo: si se refrescara al cambiar de animacion, guardaria el
     * estado que dejo la pose anterior en vez del tuyo, que es el problema que
     * esto viene a arreglar. Por eso las cuatro condiciones: nada puesto, nada
     * en bucle, nada esperando turno, y nada guardado ya. */
    if (RECORDAR_EL_ESTADO && limpia.origen !== 'bucle' && !memoriaDelEstado &&
        !enMarcha && !Bucle.activo() && !esperandoParaCambiar) {
      memoriaDelEstado = Reproductor.mirarElEstado(limpia);
      apuntar('estado guardado: arma ' + (memoriaDelEstado.armaFuera ? 'fuera' : 'guardada') +
              (memoriaDelEstado.mueble ? ', sentado' : ''));
    }

    if (limpia.origen !== 'bucle') {
      /* Pulsar la que ya esta puesta la RELANZA. Antes la paraba, y eso daba
         un fallo que parecia otra cosa: el mod no sabe cuando termina una pose
         —Skyrim no avisa— asi que durante diez segundos sigue creyendo que una
         animacion de dos segundos esta puesta. Pulsarla otra vez la paraba,
         para ti no pasaba nada porque ya se habia acabado sola, y hacia falta
         una segunda pulsacion para verla. Para cortar esta Detener. */
      /* ESTANDO EN UN MUEBLE, EL RELEVO ES SUAVE.
       *
       * Se suelta lo que lleves en las manos y se lanza la nueva directa: sin
       * el levantarse, sin el corte al estado por defecto y sin la espera. El
       * mueble es lo que sostiene la pose, asi que tirarlo la deja sin nada
       * debajo.
       *
       * Lo decide el ESTADO, no la ficha de la animacion. Antes se miraba si la
       * animacion estaba en la lista SENTADO —dieciseis entradas, a mano—, y
       * cualquier pose de silla que no estuviera en ella se iba por el camino
       * normal y te ponia de pie. Pediste algo estando sentado: lo que no
       * quieres es acabar de pie, sea la pose que sea.
       *
       * El OffsetStop si hace falta: sin el, la jarra o el libro de la pose
       * anterior se quedaban en la mano sobre la nueva. */
      if (Reproductor.enUnMueble(limpia)) {
        Reproductor.soltarLasManos(limpia);
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
      /* El corte del relevo tambien respeta el estado: cambiar de animacion
         estando sentado no tiene por que levantarte. No se repone nada aqui
         —la cadena sigue—, solo se evita romperlo. */
      Reproductor.parar({ quien: limpia.quien, origen: limpia.origen }, memoriaDelEstado);
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
    /* La memoria se tira sin reponer nada. La pose no se ha cortado: se ha
       acabado porque te has puesto a andar o a pelear, asi que el estado de
       ahora es el que TU has hecho y devolverte al de antes seria pelearse
       contigo. */
    memoriaDelEstado = null;
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

  /**
   * Esconde o ensena animaciones, sin tocar el catalogo.
   *
   * El para que: habra animaciones que solo deban ver ciertos jugadores —por
   * rol, por gremio, por lo que decida el servidor—. Esto es el interruptor;
   * quien lo acciona y con que criterio es cosa de fuera.
   *
   * No se guarda en disco a proposito: es estado de la sesion, y quien manda
   * es el servidor, que lo vuelve a decir cada vez que entras.
   *
   * Esconder NO impide reproducirla desde la puerta: el servidor puede querer
   * lanzar sobre ti una animacion que tu no tienes en el menu. Lo que hace es
   * quitarla de la lista, de la rueda y del buscador.
   */
  function pedirOcultar(cuales, seVe) {
    var lista = (typeof cuales === 'string') ? [cuales] : (cuales || []);
    var tocadas = 0;
    for (var i = 0; i < lista.length; i++) {
      var ficha = porEvento[String(lista[i])];
      if (!ficha) continue;
      if (ficha.visible === seVe) continue;
      ficha.visible = seVe;
      tocadas++;
    }
    if (tocadas) {
      apuntar((seVe ? 'mostradas ' : 'ocultadas ') + tocadas + ' animaciones');
      /* Al panel se le manda el catalogo otra vez. Es exactamente lo que hace
         anadir() cuando un mod mete animaciones nuevas: inyectar vuelve a
         pasarle el catalogo y, si ya estaba puesto, solo recarga la lista. Un
         solo camino para las dos cosas. */
      if (puesto) inyectar();
    }
    return tocadas;
  }

  /** Desatasca. Corta el bucle y deja al personaje como recien llegado. */
  function pedirReiniciar(origen, quien) {
    Bucle.quitar();
    esperandoParaCambiar = null;
    enMarcha = null;
    /* Reiniciar es borron y cuenta nueva: no se respeta ni se repone nada. Para
       eso esta este boton, y es lo que hace falta cuando lo que hay que
       deshacer es precisamente el estado (te quedaste pegado a una silla, con
       una olla en la mano, mirando al norte). */
    esperandoReponer = null;
    memoriaDelEstado = null;
    var peticion = { quien: quien || FORMID_JUGADOR, origen: origen || 'desconocido' };
    var hecho = Reproductor.reiniciar(peticion);
    if (hecho) avisarA(observadoresParar, peticion);
    decirAlPanel('parado');
    return hecho;
  }

  /* Cuando se pulso Detener por ultima vez. Dos pulsaciones seguidas
     significan que la primera no sirvio, y entonces el corte va a por todas.
     Ver Reproductor.parar. */
  var ultimoParar = 0;

  function pedirParar(origen, quien) {
    /* El margen de abajo es para que un doble clic sin querer no cuente como
       insistir: levantarse de la silla por un resbalon del raton seria peor
       que no pararse. El de arriba, porque pasados tres segundos ya no estas
       insistiendo, estas pulsando otra vez. */
    var desdeElUltimo = Date.now() - ultimoParar;
    var insistiendo = desdeElUltimo >= 250 && desdeElUltimo <= INSISTIR_EN;
    ultimoParar = Date.now();

    Bucle.quitar();          // parar es parar: si habia bucle, se acaba
    esperandoParaCambiar = null;  // y si habia una esperando su turno, tambien
    enMarcha = null;
    var peticion = { quien: quien || FORMID_JUGADOR, origen: origen || 'desconocido',
                     insistiendo: insistiendo };

    /* Se consume la memoria: el corte la respeta, y lo que haga falta reponer
       se hace un momento despues, cuando el corte ya ha pasado. */
    var memoria = memoriaDelEstado;
    memoriaDelEstado = null;

    var hecho = Reproductor.parar(peticion, memoria);
    if (hecho && memoria && (memoria.armaFuera || memoria.mueble)) {
      esperandoReponer = {
        peticion: peticion,
        memoria: memoria,
        cuando: Date.now() + ESPERA_AL_REPONER
      };
    }
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
      /* La paleta del inventario del servidor, estilo "Sin marcos", que es el
         que trae puesto de fabrica: su propio codigo dice
         AJUSTES_INICIALES = { estilo: 'limpio' }, y a ese estilo lo llama
         "Sin marcos" en la lista de ajustes.
         Nada de molduras: fondo casi negro, un borde finisimo, esquinas
         redondeadas y un velo que lo funde con el juego por un lado.
         Si el servidor cambia su tema, se cambian estos valores y el panel
         entero le sigue. */
      '#' + ID + '{',
      '  --ap-txt:#ece6da;',
      '  --ap-tenue:#9a958c;',
      '  --ap-acento:#ece6da;',
      '  --ap-acento2:#e4c789;',
      '  --ap-linea:rgba(255,255,255,.12);',
      '  --ap-hueco:rgba(0,0,0,.18);',
      '  --ap-hueco-borde:rgba(255,255,255,.1);',
      '  --ap-sel:rgba(255,255,255,.55);',
      '  --ap-sel-fondo:rgba(255,255,255,.08);',
      '  --ap-caja-fondo:rgba(10,11,13,.92);',
      '  --ap-caja-borde:1px solid rgba(255,255,255,.1);',
      '  --ap-caja-radio:10px;',
      '  --ap-caja-sombra:0 10px 28px rgba(0,0,0,.5);',
      '  --ap-boton-fondo:transparent;',
      '  --ap-boton-borde:rgba(255,255,255,.35);',
      '  --ap-boton-radio:999px;',
      /* Las fuentes del servidor. Van incrustadas en su propia pagina, asi que
         aqui solo hay que nombrarlas; los respaldos son por si el panel acaba
         en otra pagina que no las tenga. */
      '  --ap-fuente-titulo:"Aes Barlow","Din-pro",sans-serif;',
      '  --ap-fuente-nombre:"Din-pro",sans-serif;',
      '  --ap-fuente-etiqueta:"Aes Barlow","Din-pro",sans-serif}',

      /* La capa ocupa toda la pantalla porque ahora hay dos cosas en sitios
         distintos: la rueda en el centro y la ventana de la lista arriba a la
         derecha. No deja pasar el raton salvo donde hay algo. */
      '#' + ID + '{position:fixed;inset:0;z-index:9000;',
      '  font-family:var(--ap-fuente-nombre);font-size:15px;color:var(--ap-txt);',
      '  pointer-events:none;user-select:none}',
      '#' + ID + ' *{box-sizing:border-box}',

      /* El velo. Copiado tal cual del inventario del servidor, que lo hace
         asi:
             .inventory-container__velo{position:absolute;inset:0;
               background:linear-gradient(90deg,transparent 25%,
                                          rgba(5,6,8,.92) 62%);
               opacity:var(--fondo)}
         Lo importante es que ocupa la PANTALLA ENTERA, no el panel. Por eso no
         se le ve el canto: la transicion mide mas de un tercio del ancho de la
         pantalla. El mismo degradado metido dentro de un panel de 500px daria
         un desvanecido de 150px, que se ve como una raya. */
      '#' + ID + ' .ap-velo{position:absolute;inset:0;pointer-events:none;',
      '  display:none;',
      '  background:linear-gradient(90deg,transparent 25%,rgba(5,6,8,.92) 62%);',
      '  opacity:.85}',
      '#' + ID + '.ap-abierto.ap-modo-lista .ap-velo{display:block;',
      '  animation:ap-asoma .22s ease-out}',
      '@keyframes ap-asoma{from{opacity:0}to{opacity:.85}}',
      /* VARIANTE B: la rueda no lleva velo detras. El degradado lo pone cada
         sector por su cuenta (ver armarCorro). */

      /* El panel, pegado al lado derecho y de arriba abajo. Sin fondo propio:
         en este estilo el inventario apaga el suyo (__panel::before{display:
         none}) y deja el texto encima del velo. Aqui igual. */
      '#' + ID + ' .ap-panel{pointer-events:auto;position:absolute;top:0;right:0;',
      '  width:min(500px,34vw);height:100vh;',
      '  display:none;flex-direction:column;',
      /* Aire arriba y abajo: el panel llega de un canto al otro de la
         pantalla, y sin esto el titulo y los mandos quedan pegados al borde.
         Abajo mas que arriba, porque abajo hay que acertarles con el raton. */
      '  background:none;padding:34px 26px 30px}',
      /* Entra deslizandose desde el canto derecho. Tiene que ser una ANIMACION
         y no una transicion: el panel pasa de display:none a display:flex, y
         una transicion no corre sobre algo que acaba de aparecer. */
      '#' + ID + '.ap-abierto .ap-panel{display:flex;',
      '  animation:ap-entra .18s ease-out}',
      '@keyframes ap-entra{from{transform:translateX(100%);opacity:0}',
      '  to{transform:none;opacity:1}}',

      /* La cabecera, como la del inventario: sin raya debajo, solo aire. */
      '#' + ID + ' .ap-cabecera{display:flex;align-items:center;gap:12px;',
      '  margin-bottom:12px}',
      /* Y el titulo igual que el suyo en este estilo: del color del texto —no
         dorado—, en mayusculas y muy espaciado. */
      '#' + ID + ' .ap-titulo{display:flex;align-items:center;',
      '  font-family:var(--ap-fuente-titulo);font-weight:600;font-size:20px;',
      '  line-height:1.1;letter-spacing:.2em;text-transform:uppercase;',
      '  color:var(--ap-txt);text-shadow:0 1px 6px rgba(0,0,0,.8);',
      '  white-space:nowrap}',
      /* El rombo de delante: un cuadrado girado, tal cual el suyo. */
      '#' + ID + ' .ap-rombo{display:inline-block;flex:none;width:9px;height:9px;',
      '  margin-right:12px;border:1.5px solid var(--ap-acento);',
      '  transform:rotate(45deg)}',
      /* Al lado del boton de filtro, en pequeno: que se esta viendo ahora
         mismo. Antes iba en la cabecera, pero su sitio es junto al mando que
         lo cambia. */
      '#' + ID + ' .ap-donde{flex:1;font-size:12.5px;color:var(--ap-tenue);',
      '  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '#' + ID + ' .ap-cerrar{cursor:pointer;color:var(--ap-tenue);font-size:15px;',
      '  line-height:1;padding:2px 4px}',
      '#' + ID + ' .ap-cerrar:hover{color:var(--ap-acento2)}',

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
      '  letter-spacing:.5px;color:#fff;text-shadow:0 1px 3px #000;',
      '  border:none;border-radius:var(--ap-boton-radio);',
      '  background:rgba(5,6,8,.6)}',
      '#' + ID + ' .ap-cambio:hover,#' + ID + ' .ap-volver:hover{',
      '  color:var(--ap-acento2)}',
      '#' + ID + ' .ap-cambio i,#' + ID + ' .ap-volver i{font-style:normal;',
      '  font-size:9px;color:var(--ap-acento)}',
      '#' + ID + ' .ap-cambio{white-space:nowrap;padding:9px 18px;font-size:14px}',

      /* El de reiniciar va mas discreto que los demas: hace falta tenerlo a
         mano, pero no es algo que se pulse a diario. */
      /* Con la misma pastilla que "Ver todas las animaciones": este cae
         encima del juego igual que aquel, y a pelo se perdia sobre nieve. */
      '#' + ID + ' .ap-reiniciar{cursor:pointer;font-size:13.5px;color:#fff;',
      '  text-shadow:0 1px 3px #000;padding:7px 16px;margin-top:2px;',
      '  border:none;border-radius:var(--ap-boton-radio);',
      '  background:rgba(5,6,8,.6);white-space:nowrap}',
      '#' + ID + ' .ap-reiniciar:hover{color:var(--ap-acento2)}',

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
      /* El hueco del centro se oscurece el solo. Los sectores llevan el oscuro
         pegado al centro, pero el hueco no es un sector: es el agujero, y
         encima de un cielo blanco el texto se perdia.
         Va colgado de ESTA caja y no de la del texto porque esta es cuadrada.
         Un radial-gradient dibuja un circulo, pero la caja lo recorta: en una
         caja mas ancha que alta se ve el circulo con el arriba y el abajo
         cortados, o sea un rectangulo. Aqui sale redondo entero.
         Es un disco liso, no un desvanecido. El hueco del anillo tiene un
         radio del 24% de esta caja y el disco mide el 44%, o sea un radio del
         22%: quedan dos puntos de aire entre el disco y el primer sector, que
         es lo que hace que se vean como dos cosas y no como una pegada a la
         otra.
         Va colgado de ESTA caja y no de la del texto porque esta es cuadrada,
         y un circulo dentro de una caja mas ancha que alta sale recortado por
         arriba y por abajo: un rectangulo. */
      '#' + ID + ' .ap-corro-caja::before{content:"";position:absolute;',
      '  left:50%;top:50%;width:44%;height:44%;',
      '  transform:translate(-50%,-50%);border-radius:50%;',
      '  z-index:-1;pointer-events:none;background:rgba(5,6,8,.88)}',
      '#' + ID + ' .ap-rueda svg{display:block;width:100%;height:100%}',

      /* El relleno de los huecos del inventario: apenas un tinte y un borde
         finisimo. Antes era un negro al 62% porque el sector tenia que hacer
         legible su rotulo el solo; ahora de eso se encarga el velo que hay
         detras, y el sector solo tiene que verse y poder pulsarse. */
      /* Casi entero, con un desvanecido suave hacia fuera: de .9 a .62, lo
         justo para que el sector no acabe en un canto duro. El de antes se iba
         a transparente del todo y dejaba sin fondo los rotulos largos, que son
         los que caen en el borde de fuera. */
      '#' + ID + ' .ap-sector{fill:url(#ap-degradado);stroke:none;',
      '  cursor:pointer;transition:fill .12s,stroke .12s}',

      /* El sitio entero (sector y rotulo) crece un poco cuando el cursor esta
         encima. Crece hacia fuera porque el origen de la transformacion es el
         centro del corro, que es lo que hace que parezca que sale de la rueda
         en vez de moverse de sitio. */
      /* La transicion de la opacidad es la que hace que, al girar, los de la
         cola se vayan aclarando en vez de cambiar de golpe. */
      '#' + ID + ' .ap-sitio{transform-origin:310px 310px;',
      '  transition:transform .12s ease-out,opacity .28s ease-out}',
      '#' + ID + ' .ap-sitio.ap-mirando{transform:scale(1.06)}',
      /* El que se mira se marca aclarando el relleno, no dibujandole una
         linea alrededor. */
      /* El que se mira se marca OSCURECIENDOLO, no aclarandolo: encima de un
         cielo blanco aclarar no destaca, se confunde con el fondo. Oscurecer
         funciona contra cualquier cosa que haya detras. */
      /* Y ademas una linea alrededor: oscurecerlo no se nota contra un fondo
         ya oscuro —de noche, en una cueva—, y el borde si. */
      '#' + ID + ' .ap-sitio.ap-mirando .ap-sector{fill:rgba(3,4,6,.95);',
      '  stroke:var(--ap-sel);stroke-width:2}',
      /* El rotulo del que se mira va en blanco, como los demas. Lo que dice
         cual es no es el color de la letra: es que el sector se oscurece y
         crece. El dorado ahi se leia peor que el blanco. */
      '#' + ID + ' .ap-sitio.ap-mirando .ap-rotulo{fill:#fff}',

      /* Blanco puro, no el hueso del inventario: estos rotulos caen encima
         del juego, y sobre nieve o piedra clara un hueso roto se mezcla. El
         contorno negro es lo que los despega de lo que haya detras. */
      '#' + ID + ' .ap-rotulo{font-size:13px;fill:#fff;pointer-events:none;',
      '  text-anchor:middle;paint-order:stroke;stroke:rgba(0,0,0,.92);',
      '  stroke-width:3.5px;stroke-linejoin:round}',

      /* El hueco del centro dice, entera, la que estas mirando. En un sector
         no cabe "Calentarse las manos de pie". */
      /* El hueco del centro: el nombre entero —en un sector no cabria— y
         debajo los dos mandos que hacen falta sin salir de la rueda. */
      '#' + ID + ' .ap-centro{position:absolute;top:50%;left:50%;',
      '  transform:translate(-50%,-50%);width:42%;text-align:center;',
      '  pointer-events:none;text-shadow:0 2px 6px #000,0 0 14px #000}',

      /* Se mide en vmin, igual que el corro: si no, la letra se queda
         pequenaja dentro de un hueco que en pantalla grande es enorme. El tope
         en pixeles evita que en un 4K se desmadre. */
      '#' + ID + ' .ap-centro b{display:block;font-family:var(--ap-fuente-titulo);',
      '  font-size:min(2.2vmin,24px);letter-spacing:1px;color:var(--ap-txt);',
      '  line-height:1.3}',
      '#' + ID + ' .ap-centro small{display:block;margin-top:5px;',
      '  font-size:min(1.45vmin,16px);color:var(--ap-tenue)}',
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
      '  color:var(--ap-tenue);font-size:17px;background:rgba(0,0,0,.3);',
      '  border:none;border-radius:var(--ap-boton-radio)}',
      '#' + ID + '.ap-girable .ap-gira{display:flex}',
      '#' + ID + ' .ap-gira:hover{color:var(--ap-txt);',
      '  background:var(--ap-sel-fondo)}',
      '#' + ID + ' .ap-gira-izq{left:-40px}',
      '#' + ID + ' .ap-gira-der{right:-40px}',

      /* La vuelta corta al girar, para que se vea que el corro se mueve. */
      /* El lienzo es mas grande que el corro a proposito: al pasar el cursor
         por encima, el sitio crece un 6% hacia fuera, y un SVG recorta por su
         borde. Con el lienzo justo, el sector crecido se cortaba por la mitad.
         overflow visible ademas por si alguna vez crece mas. */
      '#' + ID + ' .ap-corro svg{transform-origin:310px 310px;overflow:visible}',
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

      '#' + ID + ' .ap-buscar{width:100%;padding:8px 11px;margin-bottom:9px;',
      '  background:var(--ap-hueco);border:1px solid var(--ap-hueco-borde);',
      '  border-radius:6px;',
      '  color:var(--ap-txt);font-family:inherit;font-size:15px;outline:none}',
      '#' + ID + ' .ap-buscar:focus{border-color:var(--ap-acento);',
      '  box-shadow:0 0 0 2px var(--ap-sel-fondo)}',
      '#' + ID + ' .ap-buscar::placeholder{color:var(--ap-tenue)}',

      /* La fila del filtro: el boton que abre el cajon, y al lado lo que se
         esta viendo. */
      '#' + ID + ' .ap-filtro{display:flex;align-items:center;gap:9px;',
      '  margin-bottom:8px}',
      '#' + ID + ' .ap-filtro-boton{cursor:pointer;flex:none;padding:4px 13px;',
      '  font-size:12.5px;color:var(--ap-tenue);background:var(--ap-boton-fondo);',
      '  border:1px solid var(--ap-boton-borde);border-radius:var(--ap-boton-radio);',
      '  transition:color .12s,border-color .12s,background .12s}',
      '#' + ID + ' .ap-filtro-boton:hover{color:var(--ap-txt);',
      '  border-color:var(--ap-acento)}',
      /* Con el cajon abierto, o con un filtro puesto que no sea "todas", el
         boton se queda encendido: asi se ve de un vistazo que la lista no
         esta entera. */
      '#' + ID + '.ap-filtrando .ap-filtro-boton,',
      '#' + ID + '.ap-filtrado .ap-filtro-boton{color:var(--ap-acento2);',
      '  border-color:var(--ap-acento);background:var(--ap-sel-fondo)}',
      '#' + ID + ' .ap-filtro-boton i{font-style:normal;font-size:9px;',
      '  margin-left:5px;opacity:.75}',

      /* El cajon de las categorias: cerrado de normal. Trece botones siempre
         puestos se comian un tercio de la ventana antes de la primera fila. */
      '#' + ID + ' .ap-categorias{display:none;flex-wrap:wrap;gap:4px;',
      '  margin-bottom:9px;padding-bottom:9px;',
      '  border-bottom:1px solid var(--ap-linea)}',
      '#' + ID + '.ap-filtrando .ap-categorias{display:flex}',
      '#' + ID + ' .ap-chip{cursor:pointer;padding:4px 9px;font-size:12.5px;',
      '  color:var(--ap-tenue);background:var(--ap-hueco);',
      '  border:1px solid var(--ap-hueco-borde);',
      '  border-radius:999px;white-space:nowrap}',
      '#' + ID + ' .ap-chip:hover{color:var(--ap-txt);border-color:var(--ap-hueco-borde)}',
      '#' + ID + ' .ap-chip.ap-puesto{color:var(--ap-acento2);border-color:var(--ap-acento);',
      '  background:var(--ap-sel-fondo)}',

      '#' + ID + ' .ap-lista{flex:1;overflow-y:auto;overflow-x:hidden;',
      '  margin:0 -4px;padding:0 4px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar{width:8px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-track{background:rgba(0,0,0,.35)}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-thumb{background:var(--ap-hueco-borde);border-radius:2px}',
      '#' + ID + ' .ap-lista::-webkit-scrollbar-thumb:hover{background:var(--ap-acento)}',

      '#' + ID + ' .ap-grupo{font-family:var(--ap-fuente-titulo);font-size:11.5px;',
      '  letter-spacing:2px;text-transform:uppercase;color:var(--ap-acento);',
      '  padding:9px 2px 4px;border-bottom:1px solid var(--ap-linea);',
      '  margin-bottom:3px}',

      '#' + ID + ' .ap-fila{display:flex;align-items:baseline;gap:8px;cursor:pointer;',
      '  padding:5px 7px;border:1px solid transparent;border-radius:2px}',
      '#' + ID + ' .ap-fila:hover,#' + ID + ' .ap-fila.ap-elegida{',
      '  background:var(--ap-sel-fondo);border-color:transparent}',
      '#' + ID + ' .ap-nombre{flex:1;min-width:0;overflow:hidden;',
      '  text-overflow:ellipsis;white-space:nowrap}',

      /* La estrella de favorito. Gris apagada cuando no lo es, dorada cuando
         si. Se queda siempre en su sitio, tambien apagada, para que se vea
         que se puede pulsar sin tener que pasar el raton por encima. */
      /* Ancha y con margen negativo: antes eran 16 px y acertarle costaba.
         Ahora lo que responde al raton ocupa toda la altura de la fila. */
      '#' + ID + ' .ap-estrella{flex:none;width:26px;margin:-5px -4px -5px 2px;',
      '  padding:5px 0;text-align:center;font-size:18px;line-height:1;',
      '  color:#4a4034;cursor:pointer}',
      '#' + ID + ' .ap-estrella:hover{color:var(--ap-tenue)}',
      '#' + ID + ' .ap-estrella.ap-puesta{color:var(--ap-acento2);',
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

      '#' + ID + ' .ap-vacio{padding:18px 4px;text-align:center;color:var(--ap-tenue)}',

      /* La ficha de la animacion que estas mirando. Es el tooltip del
         inventario del servidor: misma caja, mismas medidas, mismos colores.
         Va por fuera del panel —a su izquierda— para no estrechar la lista. */
      '#' + ID + ' .ap-ficha{position:absolute;display:none;width:260px;',
      '  padding:10px 12px 12px;font-size:12px;line-height:1.45;',
      '  pointer-events:none;background:var(--ap-caja-fondo);',
      '  border:var(--ap-caja-borde);border-radius:var(--ap-caja-radio);',
      '  box-shadow:var(--ap-caja-sombra)}',
      '#' + ID + '.ap-abierto.ap-modo-lista .ap-ficha.ap-puesta{display:block}',
      '#' + ID + ' .ap-ficha b{display:block;font-family:var(--ap-fuente-etiqueta);',
      '  font-size:15px;font-weight:600;color:var(--ap-acento2)}',
      /* El id, debajo y en gris: es dato tecnico, no el nombre de la cosa. */
      '#' + ID + ' .ap-ficha i{display:block;margin-top:2px;font-style:normal;',
      '  font-size:11px;color:var(--ap-tenue);word-break:break-all}',
      '#' + ID + ' .ap-ficha hr{margin:8px 0;border:none;',
      '  border-top:1px solid var(--ap-linea)}',
      '#' + ID + ' .ap-ficha p{margin:0;color:var(--ap-txt)}',
      /* Cuando no hay descripcion escrita se dice, en gris y en cursiva: una
         ficha que lo calla parece rota. */
      '#' + ID + ' .ap-ficha p.ap-sinnada{color:var(--ap-tenue);font-style:italic}',

      /* El pie lleva los mandos, centrados. Antes tenia delante el nombre de
         lo que sonaba; ya no se dice. */
      '#' + ID + ' .ap-pie{display:flex;align-items:center;gap:12px;',
      '  justify-content:center;margin-top:9px;padding-top:8px;',
      '  border-top:1px solid var(--ap-linea);font-size:12.5px;color:var(--ap-tenue)}',
      /* Un boton de contorno, sin relleno ni mayusculas.
         El degradado y el TODO EN MAYUSCULAS pesaban demasiado encima de una
         rueda que no tiene marco: parecia el boton mas importante de la
         pantalla cuando es el que menos se usa. Asi se ve, se pulsa, y no
         grita. */
      /* Con fondo oscuro y el color del texto, no el tenue: este boton sale
         encima del juego, y encima de nieve un gris claro sobre gris claro no
         se ve. Y mas grande, que antes costaba acertarle. */
      '#' + ID + ' .ap-boton{cursor:pointer;padding:9px 22px;font-size:15px;',
      '  letter-spacing:.3px;color:#fff;',
      '  border:1px solid var(--ap-boton-borde);',
      '  border-radius:var(--ap-boton-radio);background:rgba(5,6,8,.6);',
      '  text-shadow:0 1px 3px #000;',
      '  transition:color .12s,border-color .12s,background .12s}',
      '#' + ID + ' .ap-boton:hover{color:var(--ap-acento2);border-color:var(--ap-acento);',
      '  background:var(--ap-sel-fondo)}',

      /* La casilla del bucle es nuestra, no un <input type=checkbox>. En el
         navegador que Skyrim dibuja por encima del juego los controles nativos
         se ven como quieren, no como uno les dice, asi que se pinta a mano: un
         cuadrado con una marca dentro. */
      '#' + ID + ' .ap-bucle{display:flex;align-items:center;gap:6px;',
      '  color:#fff;text-shadow:0 1px 3px #000;',
      '  cursor:pointer;white-space:nowrap}',
      '#' + ID + ' .ap-bucle:hover{color:var(--ap-acento2)}',
      '#' + ID + ' .ap-casilla{width:13px;height:13px;flex:none;position:relative;',
      '  background:rgba(0,0,0,.45);border:1px solid var(--ap-hueco-borde);border-radius:2px}',
      '#' + ID + ' .ap-bucle:hover .ap-casilla{border-color:var(--ap-acento)}',
      '#' + ID + ' .ap-bucle.ap-puesto{color:var(--ap-acento2)}',
      '#' + ID + ' .ap-bucle.ap-puesto .ap-casilla{border-color:var(--ap-acento);',
      '  background:var(--ap-sel-fondo)}',
      '#' + ID + ' .ap-bucle.ap-puesto .ap-casilla::after{content:"";position:absolute;',
      '  left:3px;top:0;width:5px;height:9px;border:solid var(--ap-acento2);',
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
      '<div class="ap-velo"></div>' +
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
      '  <div class="ap-cabecera">' +
      '    <div class="ap-titulo"><span class="ap-rombo"></span>Animaciones</div>' +
      '    <div style="flex:1"></div>' +
      '    <div class="ap-cerrar" title="Cerrar (Esc)">&#10005;</div></div>' +
      '  <input class="ap-buscar" type="text" spellcheck="false"' +
      '         placeholder="Buscar por nombre o por id: rezar, IdleWave...">' +
      '  <div class="ap-filtro">' +
      '    <div class="ap-filtro-boton" title="Ver solo una categoría">' +
      'Filtro<i>&#9660;</i></div>' +
      '    <div class="ap-donde">Todas</div></div>' +
      '  <div class="ap-categorias"></div>' +
      '  <div class="ap-lista"></div>' +
      '  <div class="ap-ficha"></div>' +
      '  <div class="ap-volver"></div>' +
      '  <div class="ap-reiniciar" style="text-align:center;margin-top:4px"' +
      '       title="Si una animación se queda colgada: te saca del mueble, ' +
      'te devuelve el movimiento y la colisión, y recarga el personaje">' +
      'Reiniciar animaciones</div>' +
      '  <div class="ap-pie">' +
      '    <div class="ap-bucle" title="Repetirla hasta que pulses Detener">' +
      '      <span class="ap-casilla"></span><span>En bucle</span></div>' +
      '    <div class="ap-boton ap-parar" title="Detener la animación. Si ' +
      'alguna no se detiene, púlsalo otra vez y se fuerza">Detener</div></div>' +
      '</div>';
    document.body.appendChild(raiz);

    var caja = raiz.querySelector('.ap-buscar');
    var bucles = raiz.querySelectorAll('.ap-bucle');   // se recoge otra vez al
                                                       // rehacer el centro
    var chips = raiz.querySelector('.ap-categorias');
    var lista = raiz.querySelector('.ap-lista');

    var donde = raiz.querySelector('.ap-donde');
    var ficha = raiz.querySelector('.ap-ficha');
    var botonFiltro = raiz.querySelector('.ap-filtro-boton');
    var corro = raiz.querySelector('.ap-corro');
    var cambio = raiz.querySelector('.ap-cambio');
    var volver = raiz.querySelector('.ap-volver');
    var centro = raiz.querySelector('.ap-centro');


    /* ------------------------------------------------------------------ estado */
    var animaciones = [];
    var porEvento = {};        // para sacar la ficha de una fila por su id
    var categorias = [];
    /* Con que filtro se abre. Vacio es "Recomendadas"; se empieza por
       "todas" porque la lista completa es lo que se espera ver al abrir, y
       recomendadas se elige si se quiere. */
    var categoria = 'todas';
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
      porEvento = {};
      for (var i = 0; i < animaciones.length; i++) {
        animaciones[i]._busca = palabrasDe(animaciones[i]);
        porEvento[animaciones[i].evento] = animaciones[i];
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
        /* Ni en la lista, ni en la rueda, ni en el buscador: las escondidas
           porque el servidor lo ha decidido, y las de salida porque no son
           poses que uno elija. Ver seVe. */
        if (!seVe(a)) continue;
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
        if (!seVe(animaciones[i])) continue;
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
    /* El anillo va de DENTRO a AFUERA. Es mas largo de lo que era (medía de
       150 a 254) porque el degradado vive DENTRO de cada sector: cuanto mas
       largo el sector, mas recorrido tiene el desvanecido y mas suave queda.
       AFUERA casi toca el borde del dibujo; el SVG lleva overflow visible. */
    var CORRO = 620, CENTRO = 310, DENTRO = 150, AFUERA = 292;

    /** Cuantos sitios hay dibujados ahora mismo, para no rehacerlos por nada. */
    var dibujados = -1;

    /** Arma los sitios vacios. Solo hace falta si cambia cuantos hay. */
    function armarCorro(cuantos) {
      var paso = 360 / cuantos;
      /* El degradado de los sectores: uno para todos, centrado en el centro
         del corro y medido en las coordenadas del dibujo, asi que a cada uno
         le toca el tramo que le corresponde por su distancia. Empieza donde
         empieza el anillo. */
      var dentro = (DENTRO / AFUERA).toFixed(3);
      var trozos = ['<svg width="' + CORRO + '" height="' + CORRO +
                    '" viewBox="0 0 ' + CORRO + ' ' + CORRO + '">',
                    '<defs>',
                    '<radialGradient id="ap-degradado" gradientUnits="userSpaceOnUse"',
                    ' cx="' + CENTRO + '" cy="' + CENTRO + '" r="' + AFUERA + '">',
                    '<stop offset="' + dentro + '" stop-color="#050608" stop-opacity=".9"/>',
                    '<stop offset="1" stop-color="#050608" stop-opacity=".62"/>',
                    '</radialGradient>',
                    '</defs>'];
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
             '<div class="ap-boton ap-parar" title="Detener la animación. ' +
             'Si alguna no se detiene, púlsalo otra vez y se fuerza">' +
             'Detener</div>' +
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
        /* Sin el id: es dato tecnico y aqui no pinta nada. Solo los avisos,
           que esos si cambian lo que pasa al pulsar. */
        var avisos = [];
        if (a.andando) avisos.push('se puede andar');
        if (a.sentado) avisos.push('hay que estar sentado');
        if (a.sincroniza === false) avisos.push('solo tú');
        cabeza = '<b>' + escapar(a.nombre) + '</b>' +
                 (avisos.length
                   ? '<small>' + escapar(avisos.join(' · ')) + '</small>' : '');
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
                         cuantasSeVen() + ')';
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
        : (categoria ? nombreDe(categoria) : 'Recomendadas') +
          ' \u00b7 ' + r.lista.length;
    }

    cambio.addEventListener('click', function () { ponerModo('lista'); });
    volver.addEventListener('click', function () {
      if (!laRueda().length) return;      // no hay rueda a la que volver
      ponerModo('rueda');
    });

    /** Si esta animacion se ensena al jugador.
     *
     * Solo quedan fuera las escondidas: las que el servidor ha quitado a este
     * jugador con ap.ocultar(). Las de SALIDA si se ensenan, aunque el mod las
     * lance solo al detener; esconderlas quitaba la opcion de lanzarlas a mano
     * y no daba nada a cambio.
     *
     * Todo lo que ensena el panel —lista, rueda, chips, contadores— pasa por
     * aqui, para que no vuelva a pasar que un numero diga una cosa y en la
     * lista se vea otra.
     */
    function seVe(a) {
      return a.visible !== false;
    }

    /** Cuantas animaciones se pueden elegir ahora mismo: las que pasan seVe. */
    function cuantasSeVen() {
      var n = 0;
      for (var i = 0; i < animaciones.length; i++) {
        if (seVe(animaciones[i])) n++;
      }
      return n;
    }

    function pintarCategorias() {
      var html = ['<div class="ap-chip' + (categoria ? '' : ' ap-puesto') +
                  '" data-cat="">Recomendadas</div>'];

      /* Todas: el catalogo entero, sin recortar por recomendadas ni por
         categoria. Es la que hay que pulsar para rebuscar a mano, y con ella
         puesta la barra busca en todas las que se ven. */
      html.push('<div class="ap-chip' + (categoria === 'todas' ? ' ap-puesto' : '') +
                '" data-cat="todas">Todas ' +
                '<span style="color:var(--ap-tenue)">' + cuantasSeVen() +
                '</span></div>');

      /* La de favoritos solo sale si tienes alguno: una categoria vacia y
         permanente seria un boton que no hace nada. */
      var cuantosFav = 0;
      for (var f = 0; f < animaciones.length; f++) {
        if (!seVe(animaciones[f])) continue;
        if (favorito[animaciones[f].evento]) cuantosFav++;
      }
      if (cuantosFav) {
        html.push('<div class="ap-chip' +
                  (categoria === 'favoritos' ? ' ap-puesto' : '') +
                  '" data-cat="favoritos">\u2605 Favoritos ' +
                  '<span style="color:var(--ap-tenue)">' + cuantosFav + '</span></div>');
      }
      /* La cuenta de cada categoria es de lo que SE VE, no del total: si una
         categoria dice 109 y al pulsarla salen 0 porque estan todas
         escondidas, el numero miente. Lo mismo vale para "Todas". */
      var cuenta = {};
      for (var i = 0; i < animaciones.length; i++) {
        if (!seVe(animaciones[i])) continue;
        cuenta[animaciones[i].categoria] = (cuenta[animaciones[i].categoria] || 0) + 1;
      }
      for (var j = 0; j < categorias.length; j++) {
        var c = categorias[j];
        if (!cuenta[c.clave]) continue;              // categoria sin nada dentro
        html.push('<div class="ap-chip' + (categoria === c.clave ? ' ap-puesto' : '') +
                  '" data-cat="' + c.clave + '">' + c.nombre +
                  ' <span style="color:var(--ap-tenue)">' + cuenta[c.clave] + '</span></div>');
      }
      chips.innerHTML = html.join('');
    }

    /* Cuantos renglones se pintan de una vez. Son 384 los que se pueden ver,
       y pintarlos todos de golpe se nota en el navegador que SkyrimPlatform
       monta encima del juego: comparte maquina con Skyrim. Se pintan 60 y se
       van anadiendo segun bajas. */
    var TANDA = 60;
    var pintadas = 0;          // cuantos renglones hay puestos ahora mismo

    /**
     * Si este renglon lleva rotulo de grupo encima, y cual.
     *
     * Mira el renglon ANTERIOR en vez de llevar la cuenta segun se recorre la
     * lista. Esa es la diferencia que permite anadir por tramos: para pintar
     * del 120 al 180 no hace falta haber pasado por los 120 de antes.
     */
    function rotuloDe(r, i) {
      var a = r.lista[i];
      var esFav = !!favorito[a.evento] && categoria !== 'favoritos';
      var antes = i > 0 ? r.lista[i - 1] : null;
      var favAntes = antes && !!favorito[antes.evento] && categoria !== 'favoritos';

      /* Los favoritos van arriba y con su propia cabecera. */
      if (esFav) return i === 0 ? '\u2605 Favoritos' : '';

      /* El primero que no es favorito abre "el resto". */
      if (i === 0 || favAntes) {
        if (r.soloLoDeSiempre) {
          return 'Recomendadas &nbsp;·&nbsp; escribe o elige una categoría ' +
                 'para ver las ' + cuantasSeVen();
        }
        if (r.favoritos) return 'Las demas';
      }

      /* Y dentro del resto, un rotulo cada vez que cambia la categoria. Sale
         tambien con el filtro en "todas": son casi cuatrocientas y de corrido
         no hay por donde cogerla. */
      if (!r.soloLoDeSiempre && (!categoria || categoria === 'todas') &&
          (i === 0 || favAntes || antes.categoria !== a.categoria)) {
        return nombreDe(a.categoria);
      }
      return '';
    }

    /** El HTML de los renglones [desde, hasta). */
    function filasDe(r, desde, hasta) {
      var html = [];
      for (var i = desde; i < hasta; i++) {
        var a = r.lista[i];
        var rotulo = rotuloDe(r, i);
        if (rotulo) html.push('<div class="ap-grupo">' + rotulo + '</div>');
        html.push(
          '<div class="ap-fila' + (i === elegida ? ' ap-elegida' : '') +
          (a.sincroniza === false ? ' ap-sinsinc' : '') +
          (a.andando ? ' ap-andando' : '') +
          (a.sentado ? ' ap-sentado' : '') +
          '" data-evento="' + a.evento + '" data-i="' + i + '"' +
          (a.sincroniza === false && a.motivo
            ? ' title="Los demas no la veran: ' + escapar(a.motivo) + '"' : '') + '>' +
          '<span class="ap-nombre">' + escapar(a.nombre) + '</span>' +
          '<span class="ap-estrella' + (favorito[a.evento] ? ' ap-puesta' : '') +
          '" data-fav="' + a.evento + '" title="' +
          (favorito[a.evento] ? 'Quitar de favoritos' : 'Guardar en favoritos') +
          '">\u2605</span></div>');
      }
      return html.join('');
    }

    /** Anade la siguiente tanda al final, sin tocar lo que ya esta puesto. */
    function masFilas() {
      var r = filtrar();
      if (pintadas >= r.lista.length) return;
      var hasta = Math.min(pintadas + TANDA, r.lista.length);
      lista.insertAdjacentHTML('beforeend', filasDe(r, pintadas, hasta));
      pintadas = hasta;
    }

    function pintar() {
      var r = filtrar();
      if (elegida >= r.lista.length) elegida = Math.max(0, r.lista.length - 1);

      if (!r.lista.length) {
        lista.innerHTML = '<div class="ap-vacio">Nada con eso</div>';
        pintadas = 0;
        donde.textContent = 'sin resultados';
        return;
      }

      /* Si lo senalado cae mas abajo de la primera tanda —se ha bajado con las
         flechas, o se vuelve a una posicion guardada— se pinta hasta ahi. */
      var hasta = Math.min(Math.max(TANDA, elegida + 1), r.lista.length);
      lista.innerHTML = filasDe(r, 0, hasta);
      pintadas = hasta;
      pintarTitulo();
      var viva = lista.querySelector('.ap-elegida');
      if (viva && viva.scrollIntoView) viva.scrollIntoView({ block: 'nearest' });
    }

    /** Ensena la ficha de una fila, a su altura y a la izquierda del panel. */
    function ensenarFicha(fila) {
      var a = porEvento[fila.getAttribute('data-evento')];
      if (!a) return;
      var texto = (a.descripcion || '').trim();
      ficha.innerHTML =
        '<b>' + escapar(a.nombre) + '</b>' +
        '<i>' + escapar(a.evento) + '</i>' +
        '<hr>' +
        '<p' + (texto ? '' : ' class="ap-sinnada"') + '>' +
        escapar(texto || 'Sin descripción') + '</p>';
      ficha.classList.add('ap-puesta');

      /* Se coloca despues de meter el texto, porque hasta que no esta puesto
         no se sabe lo que mide. A la izquierda del panel, a la altura del
         renglon, y subida lo justo si se saldria por abajo. */
      var r = fila.getBoundingClientRect();
      var caja = raiz.querySelector('.ap-panel').getBoundingClientRect();
      var alto = ficha.offsetHeight;
      var arriba = Math.min(Math.max(8, r.top - 4),
                            window.innerHeight - alto - 8);
      ficha.style.top = arriba + 'px';
      ficha.style.right = (window.innerWidth - caja.left + 12) + 'px';
    }

    function esconderFicha() { ficha.classList.remove('ap-puesta'); }

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

    /* La ficha sigue al raton por la lista. Se escucha en la lista entera y
       no fila a fila: las filas se rehacen enteras en cada pintada, y atar
       cuatrocientos oyentes para volver a quitarlos es trabajo de balde. */
    lista.addEventListener('mouseover', function (e) {
      var fila = e.target.closest ? e.target.closest('.ap-fila') : null;
      if (fila) ensenarFicha(fila);
    });
    lista.addEventListener('mouseleave', esconderFicha);
    /* Y se quita al desplazar: la lista se mueve debajo y la ficha se quedaria
       senalando un renglon que ya no esta ahi. */
    lista.addEventListener('scroll', function () {
      esconderFicha();
      /* Un poco antes de llegar al fondo, no justo al llegar: asi la tanda
         siguiente ya esta puesta cuando el final entra en pantalla. */
      if (lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 320) {
        masFilas();
      }
    });

    caja.addEventListener('input', function () {
      elegida = 0;
      lista.scrollTop = 0;     // otra busqueda, otra lista: se empieza arriba
      esconderFicha();
      pintar();
    });

    /* El cajon de las categorias se abre y se cierra con el boton. Abierto o
       con un filtro puesto, el boton se queda encendido. */
    function pintarFiltro() {
      var filtrando = raiz.classList.contains('ap-filtrando');
      raiz.classList.toggle('ap-filtrado', categoria !== 'todas' && !filtrando);
    }

    botonFiltro.addEventListener('click', function () {
      raiz.classList.toggle('ap-filtrando');
      pintarFiltro();
    });

    chips.addEventListener('click', function (e) {
      var chip = e.target.closest ? e.target.closest('.ap-chip') : null;
      if (!chip) return;
      categoria = chip.getAttribute('data-cat') || '';
      elegida = 0;
      lista.scrollTop = 0;
      /* Elegida una, el cajon se cierra: ya has dicho lo que querias ver y lo
         que hace falta ahora es sitio para la lista. */
      raiz.classList.remove('ap-filtrando');
      pintarFiltro();
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

      /* Pulsar una fila la SENALA, no la lanza. Para lanzarla esta el boton
         de Ejecutar. Antes un clic de mas sobre la lista te ponia al personaje
         a hacer cualquier cosa delante de la gente. */
      /* Pulsar la fila la lanza. Lo que hace que esto no sea un disparo a
         ciegas es la ficha: al pasar el raton ya sale el nombre, el id y lo
         que hace, asi que cuando pulsas sabes lo que va a salir. */
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
    vigilarLaReposicion();
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

    /** Corta la animacion y el bucle, y te devuelve al estado de antes.
     *
     *  Si llegaste en guardia sigues en guardia, y si estas sentado te quedas
     *  sentado: ver mirarElEstado. Para salir del mueble y quedar como recien
     *  llegado esta reiniciar(). */
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

    /**
     * Esconde animaciones del panel, o las vuelve a ensenar.
     *
     *     ap.ocultar('IdleWave')            una
     *     ap.ocultar(['IdleWave', 'x'])     varias
     *     ap.mostrar('IdleWave')            deshacer
     *     ap.visible('IdleWave')            -> true / false
     *     ap.ocultas()                      -> los eventos escondidos
     *
     * Para que el servidor pueda repartir animaciones por jugador: unas las ve
     * todo el mundo y otras solo quien deba. Por ahora no esconde nada nadie:
     * todas empiezan visibles.
     *
     * Esconder NO impide reproducirla desde aqui: el servidor puede querer
     * lanzarte una animacion que tu no tienes en el menu. Lo que quita es su
     * sitio en la lista, en la rueda y en el buscador.
     *
     * No se guarda en disco: es de la sesion. Quien manda es el servidor, y lo
     * vuelve a decir cada vez que entras.
     */
    ocultar: function (cuales) { return pedirOcultar(cuales, false); },
    mostrar: function (cuales) { return pedirOcultar(cuales, true); },

    /** Si esa animacion se ve en el panel. Una que no existe cuenta como no. */
    visible: function (evento) {
      var ficha = porEvento[String(evento)];
      return !!(ficha && ficha.visible !== false);
    },

    /** Los eventos escondidos ahora mismo. */
    ocultas: function () {
      var fuera = [];
      for (var i = 0; i < catalogo.animaciones.length; i++) {
        if (catalogo.animaciones[i].visible === false) {
          fuera.push(catalogo.animaciones[i].evento);
        }
      }
      return fuera;
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
          visible: f.visible === false ? false : true,
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
