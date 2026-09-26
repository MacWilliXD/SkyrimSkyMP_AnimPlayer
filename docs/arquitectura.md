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
las 674 fichas, se pegan en el navegador al cargar la lista.

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

`parar` manda **dos** eventos y en ese orden, porque hacen cosas distintas:
`IdleFurnitureExit` te saca de una silla o una cama (si no estás en una, no hace
nada), y `IdleForceDefaultState` corta la pose. Con solo el segundo te quedas de
pie dentro de la silla.

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
- **De entrada salen tus favoritos y las recomendadas.** Abrir un menú de 674 filas que
  empieza por "Ambush Enter Instant" no le sirve a nadie. En cuanto escribes o
  eliges una categoría, se busca en todo.
- **El texto de búsqueda de cada ficha se calcula una vez**, al cargar, no en
  cada tecla.
- **No hay pestaña ni nada que pulsar antes.** La tecla saca el panel ya
  abierto. Cerrado no dibuja un solo píxel encima del juego, que es lo que de
  verdad importa: sin el foco del navegador el ratón no llega a la página, así
  que una pestaña sería un adorno que ni se puede pulsar.
- **Si SkyMP le quita el foco al navegador, el panel se cierra.** Se escucha
  `skymp5-client:browserUnfocused`, el mismo suceso con el que SkyMP avisa. Si
  no, quedaría una ventana ahí puesta que no se puede ni tocar ni cerrar.
- **El aspecto copia al panel de inventario del servidor**: mismos colores
  (`#e8c987` oro, `#6b5a3a` borde, degradado 42,33,24 → 20,16,12), mismas
  tipografías (`Bankir-Retro` en títulos, `Din-pro` en el resto) y los mismos
  remaches en las esquinas. Las tipografías ya las carga la página de SkyMP, así
  que se piden por nombre.

---

## 5. El pegamento

### La cola: por qué no se llama al juego desde un mensaje del navegador

Las llamadas nativas (`Game.getPlayer`, `Debug.sendAnimationEvent`…) **no se
pueden hacer** dentro del callback de `browserMessage`. El juego responde
`'X' can't be called in this context`.

No es una teoría: el mod de inventario de este mismo servidor lo documenta en su
propio código y resuelve igual. Las acciones se apuntan en `pendientes` y se
ejecutan en el siguiente `update`, que sí es un contexto válido.

### El margen tras la pantalla de carga

La tecla se ignora mientras hay pantalla de carga y durante 15 segundos después.
El inventario del servidor documenta un cuelgue real al abrir su panel mientras
el mundo se estaba asentando, y que un margen fijo desde el arranque no bastaba
con cargas lentas. Lo que les funcionó, y se copia aquí, es mirar la pantalla de
carga de verdad (`menuOpen` / `menuClose` con `Loading Menu`) y esperar un rato
más después de que se cierre.

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
Skyrim.esm y los DLC
      │  registros IDLE:  EDID (nombre legible)
      │                   ENAM (el evento que se manda al juego)
      │                   DNAM (la ruta del fichero de animación)
      ▼
generar-catalogo.py   se queda con los de "actors/character" (los humanoides),
      │               clasifica por reglas y marca lo que SkyMP no sincroniza
      ▼
catalogo/vanilla.json
      │
      ▼
generar-plugin.py     lo mete compacto dentro del plugin
      ▼
plugin/animplayer.js
```

El nombre del evento tiene que existir de verdad: si no existe, no pasa nada, ni
error ni animación. De ahí que la lista se saque del juego y no se escriba a
mano. El generador lo comprueba: si una animación de las "recomendadas" no
aparece en el Skyrim que se está leyendo, avisa. Ya ha servido una vez, con un
nombre de barrer que no existía.

`bsa.py` y `lz4puro.py` están porque los archivos del juego van en BSA
comprimidos con LZ4 y no hacía falta añadir dependencias para leer unos nombres.
Hoy solo hacen falta si se quiere mirar dentro de los ficheros de comportamiento
de Havok; los IDLE salen directos de los `.esm`.
