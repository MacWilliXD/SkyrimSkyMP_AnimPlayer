/* Un SkyrimPlatform de mentira, para poder probar el plugin sin abrir Skyrim.
 *
 * El plugin no se modifica ni se copia para las pruebas: se carga el archivo de
 * verdad, tal cual se instala, poniendo antes este objeto en globalThis
 * .skyrimPlatform. El plugin lo encuentra, cree que esta dentro del juego, y
 * hace lo que haria alli.
 *
 * Lo que este falso permite comprobar:
 *   - que el plugin arranca sin errores y registra sus oyentes
 *   - QUE CODIGO manda exactamente a la pagina del navegador (se guarda, y la
 *     prueba lo inyecta en un Chromium de verdad)
 *   - que al recibir un mensaje de la pagina acaba llamando a
 *     Debug.sendAnimationEvent con el evento correcto
 *   - que la puerta para otros mods (sp.storage.AnimPlayer) hace lo que dice
 *   - que la cola funciona: nada toca el juego dentro del callback del mensaje,
 *     solo en el siguiente "update"
 *
 * Lo que NO puede comprobar, y hay que mirar dentro del juego:
 *   - que la animacion se vea de verdad (eso lo decide Havok)
 *   - que los demas jugadores la vean (eso lo decide el servidor)
 *   - que la tecla llegue (buttonEvent no siempre se comporta igual)
 */
'use strict';

function crear(ajustes, archivosDePartida) {
  var registro = {
    consola: [],
    inyectado: [],          // todo lo que se manda a la pagina
    animaciones: [],        // cada Debug.sendAnimationEvent que se hace
    visible: null,
    enfocado: null,
    movimientoQuitado: 0,
    movimientoDevuelto: 0,
    terceraPersona: 0,
    colision: null,             // lo que deja setCollision
    dontMove: null,
    recargado: 0,
    armaFuera: false,           // lo que responde isWeaponDrawn
    envainadoLento: false,      // si guardar el arma tarda, como en el juego
    sentado: false,             // si el personaje esta metido en un mueble
    modosDelArma: [],           // cada setWeaponDrawnMode que se hace
    envainadas: 0,              // cada vez que se guarda el arma
    enganches: [],              // los hooks del grafo de animacion
    controlesDevueltosTodos: 0,
    peticionesHttp: [],
    teclas: {},             // codigo -> pulsada, lo que ve Input
    archivos: archivosDePartida || {}    // lo que writePlugin deja en disco
  };

  var oyentes = {};
  var unaVez = {};

  var sp = {
    settings: { animplayer: ajustes || {} },

    /* El objeto que SkyrimPlatform comparte entre todos los plugins. Es por
       donde AnimPlayer publica su puerta, asi que la prueba lo necesita para
       poder llamarla como lo haria otro mod. */
    storage: {},

    printConsole: function (t) { registro.consola.push(String(t)); },

    on: function (nombre, cb) {
      (oyentes[nombre] = oyentes[nombre] || []).push(cb);
    },
    once: function (nombre, cb) {
      (unaVez[nombre] = unaVez[nombre] || []).push(cb);
    },

    browser: {
      executeJavaScript: function (src) { registro.inyectado.push(String(src)); },
      setVisible: function (v) { registro.visible = v; },
      setFocused: function (v) { registro.enfocado = v; },
      isVisible: function () { return registro.visible !== false; },
      isFocused: function () { return !!registro.enfocado; }
    },

    Game: {
      getPlayer: function () {
        return {
          __actor: 'jugador',
          getFormID: function () { return 0x14; },
          setDontMove: function (v) { registro.dontMove = v; },
          isWeaponDrawn: function () { return !!registro.armaFuera; },
          sheatheWeapon: function () {
            registro.envainadas++;
            /* En el juego guardar el arma tarda lo que dura su animacion. Con
               envainadoLento puesto, la prueba decide cuando termina: es lo
               que permite comprobar que la pose ESPERA. */
            if (!registro.envainadoLento) registro.armaFuera = false;
          },
          getFurnitureReference: function () {
            return registro.sentado ? { __mueble: 'silla' } : null;
          },
          moveTo: function () { registro.recargado++; }
        };
      },
      getFormEx: function (id) { return { __actor: 'forma ' + id, getFormID: function () { return id; } }; },
      disablePlayerControls: function () { registro.movimientoQuitado++; },
      enablePlayerControls: function (a, b, c) {
        registro.movimientoDevuelto++;
        // El reinicio los devuelve TODOS; el cierre del panel, solo el primero.
        if (b === true && c === true) registro.controlesDevueltosTodos++;
      },
      getCameraState: function () { return 0; },          // primera persona
      forceThirdPerson: function () { registro.terceraPersona++; }
    },

    Actor: { from: function (f) { return f; } },

    /* SkyrimPlatform la expone suelta, y SkyMP la usa para quitarte la colision
       al sentarte. El reinicio tiene que poder devolverla. */
    setCollision: function (formId, hay) { registro.colision = hay; },

    /* La via que usa el propio SkyMP para envainar: 0 envaina y fuerza,
       -1 suelta el bloqueo. */
    TESModPlatform: {
      /* Fuerza la postura del arma: 0 la guarda, -1 deja de forzar. Es la via
         que usa el propio SkyMP, y la que funciona en el juego. */
      setWeaponDrawnMode: function (actor, modo) {
        registro.modosDelArma.push(modo);
        if (modo === 0) { registro.envainadas++; registro.armaFuera = false; }
      }
    },

    Debug: {
      sendAnimationEvent: function (actor, evento) {
        registro.animaciones.push({
          actor: actor && (actor.__actor || String(actor)),
          evento: evento
        });
        /* Como en el juego: el enganche se dispara tambien con lo que manda el
           propio mod. Asi la prueba comprueba que el plugin sabe distinguir su
           propio ruido de lo que hace el jugador. */
        dispararEnganches(evento);
      }
    },

    Ui: { isMenuOpen: function () { return false; } },

    /* Los enganches al grafo de animacion. La prueba se queda con los que se
       registran para poder dispararlos, que es como saltar en el juego. */
    hooks: {
      sendAnimationEvent: {
        add: function (manejador, min, max, patron) {
          registro.enganches.push({ manejador: manejador, patron: patron });
          return registro.enganches.length;
        },
        remove: function () { }
      }
    },

    /* El teclado, como lo lee SkyMP: preguntando si la tecla esta pulsada.
       La prueba lo maneja con falso.tecla(codigo, true/false). */
    Input: {
      isKeyPressed: function (codigo) { return !!registro.teclas[codigo]; },
      getNumKeysPressed: function () {
        var n = 0;
        for (var k in registro.teclas) if (registro.teclas[k]) n++;
        return n;
      }
    },

    /* Los dos que SkyrimPlatform da para guardar datos en disco. Aqui son un
       objeto en memoria, pero con la misma forma: asi la prueba puede mirar
       que se escribe, y volver a cargar el plugin con lo que quedo escrito. */
    writePlugin: function (nombre, contenido, carpeta) {
      registro.archivos[carpeta + '/' + nombre] = String(contenido);
    },
    getPluginSourceCode: function (nombre, carpeta) {
      return registro.archivos[carpeta + '/' + nombre];
    },

    HttpClient: function (origen) {
      this.post = function (camino, opciones) {
        registro.peticionesHttp.push({ origen: origen, camino: camino, opciones: opciones });
      };
    }
  };

  /** Dispara los enganches del grafo, como hace el juego con cada evento. */
  function dispararEnganches(evento) {
    for (var i = 0; i < registro.enganches.length; i++) {
      var e = registro.enganches[i];
      var patron = e.patron && e.patron.replace('*', '');
      if (patron && evento.indexOf(patron) !== 0) continue;
      e.manejador.enter({ selfId: 0x14, animEventName: evento });
    }
  }

  /* Disparadores: la prueba los usa para simular lo que hace el juego. */
  function disparar(nombre, suceso) {
    var deUnaVez = unaVez[nombre] || [];
    unaVez[nombre] = [];
    var todos = (oyentes[nombre] || []).concat(deUnaVez);
    for (var i = 0; i < todos.length; i++) todos[i](suceso);
  }

  return {
    sp: sp,
    registro: registro,
    disparar: disparar,
    hayOyente: function (nombre) {
      return !!((oyentes[nombre] && oyentes[nombre].length) ||
                (unaVez[nombre] && unaVez[nombre].length));
    },
    /** Deja que el plugin se ponga al dia: dos "update" seguidos.
     *
     * Dos y no uno porque el plugin encola cosas desde dentro de la propia
     * cola —al relevar una animacion, el corte va ahora y la nueva en el
     * cuadro siguiente—, y con un solo update la prueba veria las cosas a
     * medio hacer. En el juego esos dos cuadros son treinta milisegundos. */
    tic: function () { disparar('update'); disparar('update'); },
    /** Saltar, como en el juego. */
    saltar: function () { dispararEnganches('JumpStandingStart'); },

    /** Otra cosa que hace el jugador: empezar a andar, atacar, desenfundar. */
    elJuegoHace: function (evento) { dispararEnganches(evento); },

    /** Pulsar o soltar una tecla, como lo veria el sondeo del plugin. */
    tecla: function (codigo, pulsada) { registro.teclas[codigo] = !!pulsada; },
    /** El codigo que el plugin ha mandado a la pagina, del mas reciente atras. */
    ultimaInyeccion: function (contiene) {
      for (var i = registro.inyectado.length - 1; i >= 0; i--) {
        if (registro.inyectado[i].indexOf(contiene) !== -1) return registro.inyectado[i];
      }
      return null;
    }
  };
}

/** Carga el plugin de verdad contra este SkyrimPlatform falso. */
function cargarPlugin(rutaDelPlugin, ajustes, archivosDePartida) {
  var fs = require('fs');
  var falso = crear(ajustes, archivosDePartida);
  globalThis.skyrimPlatform = falso.sp;
  // eval y no require: el plugin es un IIFE sin exports, igual que en el juego.
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(rutaDelPlugin, 'utf8'));
  return falso;
}

module.exports = { crear: crear, cargarPlugin: cargarPlugin };
