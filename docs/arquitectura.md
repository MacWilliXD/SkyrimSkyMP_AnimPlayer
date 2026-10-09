# Cómo está hecho AnimPlayer

Todo el mod es **un solo archivo**, `plugin/animplayer.js`. No es una elección
estética: un plugin de SkyrimPlatform no puede importar otros archivos. No hay
`require`, ni `fs`, ni módulos. Lo único que puede leer de fuera es su propio
archivo de ajustes.

Así que la separación es por capas dentro del archivo, y el archivo va de dentro
hacia fuera.

---

## Las seis capas

```
   ┌──────────────────────────────────────────────────────┐
   │ 6. LA PUERTA   lo que otros mods pueden llamar       │
   ├──────────────────────────────────────────────────────┤
   │ 5. PEGAMENTO   tecla · foco · mensajes · cola        │
   ├──────────────────────────────────────────────────────┤
   │ 4. INTERFAZ    el panel (vive en la página)          │
   ├──────────────────────────────────────────────────────┤
   │ 3. TRANSPORTE  pedirAnimacion()  ← la puerta única   │
   ├──────────────────────────────────────────────────────┤
   │ 2. REPRODUCTOR lo único que toca el juego            │
   ├──────────────────────────────────────────────────────┤
   │ 1. CATÁLOGO    qué animaciones hay                   │
   └──────────────────────────────────────────────────────┘
```

Cada capa solo conoce a la de debajo.

---

## 1. El catálogo

El bloque `CATALOGO` del plugin lo escribe `herramientas/generar-plugin.py`, y
está entre dos marcas para que se pueda regenerar sin tocar nada más.

Va dentro del código porque un plugin no puede leer archivos. El sitio donde el
usuario añade **sus** animaciones es el archivo de ajustes, y `mezclarCatalogo`
junta las dos listas al arrancar.

Las del usuario ganan si el evento se repite, así que se puede renombrar o
recategorizar una animación del juego sin regenerar nada.

Se guarda compacto: las palabras de búsqueda de cada categoría no se repiten en
las 737 fichas, se pegan en el navegador al cargar la lista.

De esas 737 se ven **228**. El resto está escondido, no borrado: el servidor las
puede lanzar igual, y en el buscador salen escribiendo `#hidden` delante. Quién
está en cada grupo lo decide la hoja de revisión, no el código — ver
[la-hoja.md](la-hoja.md).

### Los nombres, en español

Los que trae el juego son los identificadores de editor de Bethesda, en inglés
y a veces mal puestos: el EDID de `IdleKneeling` dice *CheckCorpse*, el de
`IdleChairExitStart` dice *HadvarWriteLedgerExit*, el de `blockStart` dice
*BowZoom*. Traducirlos al pie de la letra habría dado nombres falsos.

`herramientas/traducciones.py` los traduce mirando el **nombre del evento**, que
es lo único fiable, en tres capas:

- una tabla a mano, que es la que manda,
- reglas para los ochenta y pico golpes de gracia, que siguen todos el mismo
  patrón (arma, criatura, golpe, variante) y escribirlos uno a uno habría sido
  copiar la misma frase ochenta veces,
- un diccionario palabra a palabra como red de seguridad, para que una
  animación nueva que nadie haya traducido no salga en inglés del todo.

El nombre original entra en las palabras de búsqueda, así que buscar `chair`
sigue funcionando.

### Los favoritos

Viven aquí porque son datos del catálogo, no de la interfaz: el panel solo los
pinta. Se guardan con `sp.writePlugin(..., 'PluginsNoLoad')` y se leen con
`sp.getPluginSourceCode`, que son las dos funciones que SkyrimPlatform da para
datos en disco y las que usa SkyMP para recordar tu sesión.

**No se usa `localStorage`**, que sería lo evidente: el navegador que
SkyrimPlatform monta encima del juego no garantiza que su almacenamiento
sobreviva a cerrar Skyrim, y unos favoritos que se borran al salir no son
favoritos.

El archivo empieza por `//` para que siga siendo JavaScript válido, que es el
mismo truco que hace SkyMP con los suyos.

---

## 2. El reproductor

Lo único de todo el archivo que habla con el juego:

```js
Reproductor.actorDe(peticion)    // el actor sobre el que actuar
Reproductor.reproducir(peticion) // Debug.sendAnimationEvent
Reproductor.parar(peticion)      // salir del mueble y volver a la postura normal
```

Si algún día cambia la forma de reproducir animaciones, se cambia aquí y en
ningún otro sitio.

### Parar es lo más difícil de todo esto

Skyrim no tiene una función de «parar la animación». Lo que hay son eventos
genéricos de parada en el grafo del personaje, y cada uno hace una cosa:

```
OffsetStop          la pose que va encima de la postura
AnimObjectStop      lo que el juego te pone en la mano: la copa, la jarra, el libro
IdleFurnitureExit   te saca de la silla  (solo si no estás en una)
IdleStop            y el idle en sí
```

Los cuatro, en ese orden. Cada uno está ahí porque faltaba:

**`IdleForceDefaultState` NO se manda.** Fue lo primero que se probó, y es el
consejo que circula por los foros. Su registro IDLE se llama *ResetRoot*: no
para la animación, devuelve la raíz del grafo a su estado por defecto —de pie,
manos vacías, fuera de cualquier mueble—. Literalmente eso. Se llevaba por
delante la guardia y la silla, y de ahí venía que al encadenar animaciones el
personaje se quedara con las manos bajadas.

> Ojo también con `PlayIdle(IdleStop_Loose)`, que se lee por ahí.
> `IdleStop_Loose` no es un evento: es el editorId de un registro cuyo evento se
> llama `IdleStop`. `PlayIdle` recibe registros y `sendAnimationEvent` nombres
> de evento, así que mandar esa cadena por aquí no hace nada. Y sin dar error,
> que es lo peor que puede pasar con un evento de animación.

**`AnimObjectStop` apareció con el brindis.** «Brindar» no se detenía. En el
grafo del personaje —los `.hkx`, que son binarios de Havok pero llevan los
nombres dentro como texto plano— se ve por qué:

```
IdleMQ201ToastStart
AnimObjectMQ201Goblet            <- la copa
MQ201Party_HoldingDrinkR_ToastHold.HKX
```

No existe ningún `IdleMQ201ToastStop`. Lo que hay es una copa, y el corte nunca
le decía al juego que la soltara.

**Pero con el arma fuera ese evento no se manda.** El arma pasa por el mismo
sistema que la copa: en el grafo están `AnimObjectDrawBlade`,
`AnimObjectIronSword`, `AnimObjectEquip`, `UnequipAnimObjectState`. Soltar «lo
de la mano» soltaba también la espada.

**Y detrás del corte, si el arma sigue fuera, va `combatStanceStart`.** Con el
arma desenvainada tu sitio no es «de pie con las manos vacías»: es la guardia.
Esto es lo que hace que el arreglo sea general — da igual cuál de los eventos
del corte tire la postura, detrás se te devuelve a ella. Perseguir uno a uno los
eventos que la tiraban era ir a ciegas.

**Si insistes, va a por todas.** Quedan animaciones que meten al personaje en un
subgrafo sin salida propia y solo se sueltan reseteando la raíz. Eso es brusco y
no puede ser lo que pase al pulsar una vez, así que se escalona: pulsar Detener
otra vez entre un cuarto de segundo y tres segundos después manda también
`IdleOffsetStop`, `IdleStopInstant` e `IdleForceDefaultState`. El cuarto de
segundo de margen es para que un doble clic sin querer no te levante de la
silla.

### El bucle

Vive junto al reproductor porque es reproducción, no interfaz. Guarda la última
petición y la vuelve a mandar cada `intervaloBucle` milisegundos desde el
`update`. Sobrevive a cerrar el panel: se corta con Parar, o eligiendo otra
animación con la casilla quitada.

Es así de simple porque no hay otra forma: Skyrim no dice cuánto dura una
animación ni avisa de que ha acabado.

---

## 3. El transporte: la puerta única

```js
pedirAnimacion({ evento: "IdleWave", quien: 0x14, origen: "interfaz" })
```

**Todo** pasa por aquí: la interfaz, el bucle, y lo que venga después. La
petición es un objeto plano y serializable a propósito — es exactamente lo que
se mandará por la red.

Hay dos transportes:

- **`local`** — se reproduce aquí. Los demás jugadores la ven igual, porque
  SkyMP reenvía el evento por su cuenta (ver [sincronizacion.md](sincronizacion.md)).
  Es el recomendado y el que viene puesto.
- **`servidor`** — además avisa por HTTP a `servidor.url`. Con `soloServidor`
  puesto ni siquiera se reproduce aquí: se espera a que el servidor lo mande de
  vuelta, que es lo que hace falta si el servidor tiene que poder decir que no.

Añadir un transporte nuevo es añadir una función a `Transportes`. Ni la interfaz
ni el reproductor se enteran.

---

## 4. La interfaz vive en la página, no en el plugin

SkyrimPlatform dibuja por encima del juego una página web de verdad (Chromium).
Un plugin no puede pintar en ella: solo puede mandarle JavaScript con
`sp.browser.executeJavaScript`.

Así que el panel se escribe como una función normal, con su HTML y su CSS, y se
manda convertida en texto:

```js
sp.browser.executeJavaScript(
  '(' + panelEnLaPagina.toString() + ')(' + JSON.stringify(catalogo) + ');');
```

Es el mismo truco que usa el propio cliente de SkyMP para sus widgets
(`FunctionInfo.getText`). La ventaja es grande: el código del panel se lee y se
edita como código, no como una cadena gigante llena de comillas escapadas.

**La única regla**: esa función no puede usar nada de fuera de sí misma. Al
convertirse en texto se queda sin el contexto del plugin. Todo lo que necesite
entra por sus parámetros.

### Detalles del panel que no son caprichos

- **Se cuelga de `document.body`, no de `#root`.** `#root` es donde React de
  SkyMP dibuja lo suyo; meterse ahí es que te borren en el siguiente repintado.
- **La casilla del bucle está pintada a mano**, no es un `<input type=checkbox>`.
  En el navegador que Skyrim dibuja encima del juego los controles nativos se
  ven como quieren. Lo mismo pasa con `<select>`: por eso las categorías son
  botones y no una lista desplegable.
- **Los favoritos van siempre delante**, salvo cuando ya estás mirando solo los
  favoritos, que entonces sería ordenar por nada.
- **Pulsar la estrella no reproduce.** Se mira antes que la fila y se corta el
  suceso ahí: si no, marcar algo te dejaría al personaje haciendo la animación
  sin haberla pedido.
- **La categoría Favoritos solo sale si tienes alguno.** Una categoría vacía y
  permanente es un botón que no hace nada.
- **De entrada salen tus favoritos y las recomendadas.** Abrir un menú de 228
  filas no le sirve a nadie. En cuanto escribes o eliges una categoría, se
  busca en todo.
- **La lista se pinta por tandas de sesenta.** Pintar las 228 de golpe se nota
  en el navegador que SkyrimPlatform monta encima del juego: comparte máquina
  con Skyrim. Al bajar se van **añadiendo** las siguientes, no rehaciendo las
  que ya están.

  Lo que costaba de esto eran los rótulos de grupo (`COMBATE`, `COMER Y
  BEBER`), que se decidían llevando la cuenta de arriba abajo: para empezar por
  el 120 había que haber pasado por los 119 anteriores. Ahora cada renglón mira
  el anterior y decide solo —*lleva rótulo si es el primero, o si el de antes
  era de otra categoría*—, que da el mismo resultado y se puede empezar por
  donde sea.
- **Pulsar un renglón no rehace la lista**, solo mueve la marca. Rehacerla
  pintaba menos renglones de los que ya había —la cuenta de la tanda miraba lo
  señalado, no lo puesto— y el navegador te subía de golpe. La lista daba un
  salto justo al pulsar, y solo con muchas a la vista.
- **Al pasar el ratón sale una ficha** con el nombre y lo que hace. Es lo que
  permite que pulsar lance la animación directamente sin que sea un disparo a
  ciegas.
- **El id no se ve en ningún sitio.** Ocupaba un tercio del renglón, se cortaba
  a la mitad y le robaba el sitio al nombre, que también se cortaba. Buscar por
  id sigue funcionando; simplemente no se anuncia.
- **Los números, solo al buscar.** El panel iba lleno de cuentas —cuántas hay
  en total, cuántas por categoría— y eso es información de inventario, no de
  uso. El único que dice algo es cuántas ha encontrado lo que acabas de
  escribir.
- **El texto de búsqueda de cada ficha se calcula una vez**, al cargar, no en
  cada tecla.
- **No hay pestaña ni nada que pulsar antes.** La tecla saca el panel ya
  abierto. Cerrado no dibuja un solo píxel encima del juego, que es lo que de
  verdad importa: sin el foco del navegador el ratón no llega a la página, así
  que una pestaña sería un adorno que ni se puede pulsar.
- **Si SkyMP le quita el foco al navegador, el panel se cierra.** Se escucha
  `skymp5-client:browserUnfocused`, el mismo suceso con el que SkyMP avisa. Si
  no, quedaría una ventana ahí puesta que no se puede ni tocar ni cerrar.
- **El aspecto copia al inventario del servidor**, y no de memoria: sale de
  leer su CSS en `Data/Platform/UI/build.js`, que lleva las hojas dentro de un
  `eval`. Su propio código dice con qué estilo viene de fábrica:

  ```js
  const AJUSTES_INICIALES = { estilo: 'limpio', ... };
  const ESTILOS = [ { id: 'limpio', nombre: 'Sin marcos' }, ... ]
  ```

  Y ese estilo hace dos cosas que no son evidentes:

  1. **El degradado no es el fondo del panel**: es una capa aparte que ocupa la
     pantalla entera (`inset:0`, de transparente al 25% a casi negro al 62%).
     Por eso no se le ve el canto. El mismo degradado metido dentro de un panel
     de 500 px da un desvanecido de 150 px, que se ve como una raya.
  2. **El panel no tiene fondo propio**: apaga el suyo con
     `__panel::before{display:none}` y deja el texto encima del velo.

  Las tipografías (`Aes Barlow`, `Din-pro`) ya las carga la página de SkyMP, así
  que se piden por nombre.
- **Nada de `inset` ni de `min()` en el CSS.** La página no la dibuja Chrome:
  la dibuja el Chromium que trae el cliente de SkyMP, y cada versión del cliente
  trae el suyo. `inset` es de Chromium 87 y `min()` de 79; cuando no los
  entiende no avisa, se salta la línea y sigue — y lo que se salta es justo lo
  que da la forma. Se escriben `top/right/bottom/left` y `width` + `max-width`,
  que hacen lo mismo y los entiende cualquiera.
- **La rueda de favoritos es la otra vista.** Un corro de hasta quince sectores
  con el hueco en el centro, donde van el nombre de lo que miras y los dos
  mandos. Los sectores llevan un degradado radial suave y el hueco se oscurece
  solo, porque sobre un cielo blanco el texto se perdía. El que miras se marca
  **oscureciéndolo**, no aclarándolo: encima de nieve, aclarar no destaca.

---

## 5. El pegamento

### La cola: por qué no se llama al juego desde un mensaje del navegador

Las llamadas nativas (`Game.getPlayer`, `Debug.sendAnimationEvent`…) **no se
pueden hacer** dentro del callback de `browserMessage`. El juego responde
`'X' can't be called in this context`.

No es una teoría: el mod de inventario de este mismo servidor lo documenta en su
propio código y resuelve igual. Las acciones se apuntan en `pendientes` y se
ejecutan en el siguiente `update`, que sí es un contexto válido.

### La tecla se lee sondeando, no con `buttonEvent`

Lo evidente es `sp.on('buttonEvent')`. Y falla: a veces hay que pulsar la tecla
dos o tres veces para que el panel salga.

La pista está en el cliente de SkyMP de este servidor: en todo el archivo hay
**una sola** llamada a `buttonEvent`, y no la usa para teclas. Todo su manejo de
teclado —el inventario con F2 incluido— pasa por un `KeyboardEventsService` que
**sondea**: mira en cada vuelta si la tecla está pulsada, con
`Input.isKeyPressed`. Si quienes hicieron el cliente prefirieron sondear, por
algo será.

Aquí se hace lo mismo, y además se deja `buttonEvent` puesto como refuerzo: si
uno de los dos no llega, el otro sí. Para que no cuenten la misma pulsación dos
veces hay una ventana de descarte de 250 ms; sin ella, con los dos caminos
funcionando, la ventana se abriría y se cerraría al instante y parecería que la
tecla no hace nada.

Cuesta una llamada nativa por cuadro, que no es nada. SkyMP se ahorra hasta eso
mirando antes `getNumKeysPressed()`, pero ellos tienen muchas teclas atadas y
aquí hay una: no compensa perder fiabilidad en el caso de soltar una tecla y
pulsar la nuestra en el mismo cuadro.

**Ojo con lo que no se puede usar**: `Input.releaseKey` / `holdKey` / `tapKey`.
El mod de inventario documenta cuelgues reales del juego
(`EXCEPTION_ACCESS_VIOLATION`, confirmado con CrashLogger) por usarlas.
`isKeyPressed` solo lee, y es seguro.

### La página no es nuestra, y se recarga

El panel se mete en la página del navegador de SkyMP, que se puede recargar al
conectar, al reconectar o si el servidor la cambia. Cuando pasaba, el panel
desaparecía pero el plugin seguía creyendo que estaba puesto: la tecla dejaba de
hacer nada **para siempre**, no «a veces».

Dos redes:

- Cuando la interfaz de SkyMP termina de cargar, manda `front-loaded` por
  `sendMessage`. Ese mensaje nos llega también, aunque no sea nuestro, y es
  exactamente la señal que hace falta: la página es nueva, así que se vuelve a
  poner el panel.
- Y cada vez que se le pide algo al panel se pregunta de paso si está. Si no,
  la propia página contesta `animplayer:falta` y se repone, repitiendo lo que se
  le estaba pidiendo.

### El margen tras la pantalla de carga

La tecla no abre el panel mientras hay pantalla de carga ni durante 15 segundos
después. El inventario del servidor documenta un cuelgue real al abrir su panel
mientras el mundo se estaba asentando, y que un margen fijo desde el arranque no
bastaba con cargas lentas. Lo que les funcionó, y se copia aquí, es mirar la
pantalla de carga de verdad (`menuOpen` / `menuClose` con `Loading Menu`) y
esperar un rato más después de que se cierre.

Lo que sí cambió: antes la pulsación se tiraba a la basura en silencio. Pulsabas
nada más aparecer en el mundo, no pasaba nada, y no había forma de saber por
qué — de ahí buena parte de los «tengo que darle varias veces». Ahora se apunta
y el panel se abre solo en cuanto el mundo está listo.

### El estado se cambia ya; el efecto se encola

Abrir y cerrar son dos cosas distintas y no conviene mezclarlas:

- **el estado** (la variable `abierto`) se cambia en el momento,
- **el efecto** (foco del navegador, movimiento del personaje) se encola.

Si el estado se cambiara también dentro de la cola, dos avisos seguidos de la
página se pisarían: al llegar el *"me he cerrado"*, la variable todavía diría
que está cerrado —porque el *"me he abierto"* anterior sigue en la cola— y el
cierre se descartaría. El plugin se quedaría creyendo que hay un panel abierto
que ya no existe, con el movimiento del personaje bloqueado y sin nada en
pantalla que lo explique.

No es hipotético: pasa cuando SkyMP le quita el foco al navegador, el panel se
cierra solo, y los dos avisos llegan en la misma vuelta. Lo encontró la prueba.

Y cuando el panel se abre desde la página, el plugin hace lo suyo **sin volver a
decirle al panel que se abra**, que ya lo está. Por eso `abrir` y `cerrar`
llevan un parámetro `avisarAlPanel`, y por eso los del panel no hacen nada si ya
estabas así: sin esas guardas serían dos espejos mirándose.

### El movimiento

Mientras el panel está abierto se llama a `disablePlayerControls(true, false,
…)`: solo el movimiento. La cámara, el combate, los menús y activar cosas se
quedan como estaban, igual que hace el inventario del servidor.

Sin esto, escribir `saludar` en la barra de búsqueda te hace caminar.

---

## 6. La puerta para otros mods

Se publica en `sp.storage.AnimPlayer` (y en `globalThis.AnimPlayer`, que apunta
a lo mismo). `storage` es el objeto que SkyrimPlatform comparte entre plugins y
que sobrevive a las recargas en caliente; es donde el propio cliente de SkyMP
deja las cosas que otros tienen que poder tocar, incluso objetos con métodos.

**Todo lo que entra por la puerta se encola** hasta el siguiente `update`. Es lo
que hace que se pueda llamar desde cualquier sitio: si un mod pide una animación
desde el callback de un mensaje del navegador o de una petición HTTP, la llamada
al juego se haría en un contexto inválido y fallaría. Encolando, no.

La consecuencia es que las funciones devuelven "he aceptado la petición", no "ya
está hecho". Para lo segundo están los observadores (`alReproducir`, `alParar`),
que además avisan de lo que piden los demás, con su `origen`.

`anadir()` permite que un mod registre sus animaciones en caliente: entran en el
catálogo, se reconstruye el índice de búsqueda y se le vuelve a mandar la lista
al panel, que se entera sin reiniciar nada.

El manual está en [api.md](api.md).

Aviso heredado del mod de inventario, que conviene no olvidar: **no usar
`Input.releaseKey` / `holdKey` / `tapKey`**. Su código documenta cuelgues reales
del juego (`EXCEPTION_ACCESS_VIOLATION`, confirmado con CrashLogger) por
usarlas.

---

## De dónde sale el catálogo

Las herramientas de `herramientas/` leen el Skyrim instalado:

```
Skyrim.esm y los DLC            catalogo/revisado.csv
      │  registros IDLE:              │  nombre, descripción, estado
      │    EDID  nombre legible       │  las 737 revisadas en el juego
      │    ENAM  el evento            │
      │    DNAM  el fichero .hkx      │
      └──────────────┬────────────────┘
                     ▼
         generar-catalogo.py    se queda con los de "actors/character",
                     │          cruza con la hoja y reparte por categorías
                     ▼          mirando el NOMBRE, no el id
            catalogo/vanilla.json
                     │
                     ▼
         generar-plugin.py      lo mete compacto dentro del plugin
                     ▼
            plugin/animplayer.js
```

El juego dice **qué animaciones existen**; la hoja dice **cuáles sirven y cómo
se llaman**. Ninguna de las dos sola basta: el juego no sabe español y la hoja
no sabe qué hay instalado. Ver [la-hoja.md](la-hoja.md).

El nombre del evento tiene que existir de verdad: si no existe, no pasa nada, ni
error ni animación. De ahí que la lista se saque del juego y no se escriba a
mano. El generador lo comprueba: si una animación de las "recomendadas" no
aparece en el Skyrim que se está leyendo, avisa. Ya ha servido una vez, con un
nombre de barrer que no existía.

`bsa.py` y `lz4puro.py` están porque los archivos del juego van en BSA
comprimidos con LZ4 y no hacía falta añadir dependencias para leer unos nombres.
Los IDLE salen directos de los `.esm`; esos dos hacen falta para lo otro.

### El grafo del personaje

`Data/meshes/actors/character/behaviors/*.hkx` son binarios de Havok, pero los
nombres de evento van dentro **como texto plano**: se leen las cadenas
imprimibles y ya. Son 6202.

Eso no es una curiosidad: es de donde han salido las dos cosas más difíciles de
este mod. La lista completa de eventos genéricos de parada —y darse cuenta de
que se mandaban tres de cinco— y por qué «Brindar» no se detenía, que fue ver
`AnimObjectMQ201Goblet` al lado de `IdleMQ201ToastStart` y entender que lo que
quedaba puesto era la copa.

Cuando una animación se porte raro, el sitio donde mirar es ese.
