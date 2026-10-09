# La hoja de revisión

Lo que decide qué animaciones salen en el panel no está en el código: está en
una hoja de cálculo con las 737 filas, revisadas una a una dentro del juego.

Esta página cuenta por qué, y cómo es el circuito.

---

## Por qué una hoja y no reglas

Al principio eran reglas. Se miraba el nombre del evento y se decidía por
familias: los golpes de gracia fuera, lo que el juego usa él solo fuera, lo que
depende de un mueble fuera. Eso acierta en la mayoría.

El problema son las excepciones, y solo se ven jugando:

- Las de taller —ponerse a la forja, al horno, al molino— las descartaba la
  regla de muebles. Técnicamente lo son. Pero se ven bien y son justo lo que
  hace falta para interpretar un oficio: un herrero necesita poder herrar.
- Las de los presos del carro pasaban todos los filtros. Sin el carro delante,
  el jugador aparece flotando en el aire.
- Las actitudes de conversación («Actitud: cercana», «Hablar enojado») parecen
  poses y no lo son: cambian cómo gesticula el personaje **mientras habla**, y
  sueltas no se ve nada.

Durante un tiempo convivieron tres capas decidiendo lo mismo —las reglas, unas
correcciones a mano y la hoja— y cada una tapaba a la anterior. Para saber por
qué una animación concreta salía o no, había que seguir las tres.

Ahora manda la hoja y solo la hoja:

```
estado == "Aceptado"   ->  se ve
cualquier otra cosa    ->  escondida
```

Las reglas siguen en el repositorio porque son las que **generaron** la hoja la
primera vez —`descartes.py`, `dependencias.py`, `hoja-completa.py`—, pero ya no
tocan la visibilidad.

---

## Las columnas

| columna | qué es |
|---|---|
| `id` | el nombre del evento. **No se toca nunca**: es lo que une la fila con el juego |
| `nombre` | lo que se ve en el panel |
| `descripción` | lo que sale en la ficha al pasar el ratón |
| `estado` | `Aceptado` o cualquier otra cosa |
| `nota` | por qué se descartó, para acordarse dentro de tres meses |
| `dependencia` | qué estado necesita el jugador: «Estar sentado», «Necesita un arma desenvainada» |
| `editorId` | el nombre que le puso Bethesda. Está de referencia, no se usa |

---

## El circuito

```
Google Sheets
     │  se baja como CSV
     ▼
catalogo/revisado-nuevo.csv
     │  python herramientas/pulir-hoja.py
     ▼
catalogo/hoja-pulida.csv  ──────────►  se vuelve a subir a Google
     │  (copiado a revisado.csv)
     ▼
python herramientas/generar-catalogo.py     juego + hoja
     ▼
catalogo/vanilla.json
     │  python herramientas/generar-plugin.py
     ▼
plugin/animplayer.js
```

Para bajar la hoja:

```bash
curl -sL "https://docs.google.com/spreadsheets/d/<ID>/export?format=csv" \
     -o catalogo/revisado-nuevo.csv
```

`pulir-hoja.py` usa `revisado-nuevo.csv` si existe y `revisado.csv` si no, así
que volver a pulir lo ya pulido no hace daño.

---

## Qué hace `pulir-hoja.py`

Cuatro cosas, en este orden. El orden importa.

### 1. Las correcciones de estado

De `estados.py`, lo primero de todo, porque lo demás depende de si una fila
está aceptada.

Existe ese archivo por una razón concreta: el circuito pasa por Google, y una
corrección escrita solo en el CSV de paso **la borra la siguiente bajada**,
porque allí sigue el valor viejo. Escrita en `estados.py` se vuelve a aplicar
cada vez, venga la hoja como venga. Va indexada por `id`, que no cambia nunca.

### 2. Fuera las cláusulas de dependencia

Había descripciones que acababan repitiendo la columna de al lado:

```
Desplomarse sobre la mesa. Necesita: estar delante de la mesa de trabajo.
```

Se corta desde `Necesita` / `Depende` / `Requiere` / `Hace falta` hasta el final
de la frase.

### 3. Todo en infinitivo

No es un criterio inventado: cuatro de cada cinco aceptadas ya empezaban así. Lo que
había era un puñado sueltas en presente («Cae al suelo…», «Estira tus brazos…»).
Se pasan con una tabla de conjugados, más tres que hubo que reescribir enteras
porque no eran un cambio de palabra.

Los **nombres** se tocan solo donde hay un verbo natural detrás. Las que son
etiquetas —«Actitud: cercana», «Preso A: en el carro», «Puñetazo con la
derecha»— se quedan: forzarlas a verbo las cambiaría demasiado.

### 4. Las repetidas llevan letra

Convivían `Baile`, `Baile 2` y `Baile (3)` — tres estilos, y el primero sin
nada. Ahora:

```
Baile (A)    Baile (B)    Baile (C)
```

La letra va **siempre**, también en la primera. Que una copia vaya a secas y las
demás numeradas era justo lo confuso.

Se ordenan por el número que tuvieran, para que las letras salgan en ese mismo
orden y no se barajen. Los decimales cuentan: había dos `Retroceder por golpe
3.2` que si no quedaban en un grupo aparte del `3`, siendo la misma acción.

### Y las descripciones cortas

85 de las aceptadas tenían menos de cinco palabras, y muchas eran el nombre
repetido: «Llorar :: Empezar a llorar», «Bailar (A) :: Baile». Están escritas a
mano en `descripciones.py`, una por una.

No se pueden generar con reglas: «Reírse (A)» y «Reírse (E)» se llaman casi
igual y son dos animaciones distintas; lo único que las separa es lo que hace el
personaje. Por eso esa tabla va indexada **por el nombre ya con su letra**, que
es el único que las distingue.

---

## Las categorías salen del nombre

De `categorias.py`, y no del id. El id y lo que hace la animación no siempre
coinciden —el editorId no coincide con el evento en 456 de las 737— y se veía a
simple vista:

```
"Golpear el suelo"        estaba en magia
"Entregar algo"           partido entre magia y oficios
"Tambalear (A)" y "(B)"   una en comer y otra en magia
```

El nombre está escrito mirando la animación. Es mejor dato.

Son una lista **ordenada** de reglas, y gana la primera que encaja: lo concreto
antes que lo general, o «arrodillarse en el altar» acabaría con todas las de
rodillas. Las palabras se buscan **enteras**: con búsqueda por trozo, `Ca-minar`
caía en martillo y `S-altar` en vela. Pasó.

Una animación puede estar en **varias**. Tiene una principal —la primera regla
que encaja, la que manda para agrupar la lista— y las que quiera de secundarias;
en el filtro valen todas igual. «Beber de taza sentado» es comer y es sentarse,
y obligarla a elegir la escondía de la mitad de la gente que la iba a buscar.

---

## Cuando algo no cuadra, el generador lo dice

Las tablas escritas a mano van por nombre o por id, y un nombre mal escrito no
daría error: simplemente no haría nada, y la decisión se perdería sin que nadie
se enterara. Así que todas avisan:

```
OJO: descripciones.py nombra filas que no existen:
     Apla*ú*dir (A)
OJO: siguen con menos de 5 palabras (5):
     Aplaudir (A)
```

Ese aviso de arriba es real: al ponerle los acentos a las descripciones, un
reemplazo de `laud` → `laúd` se llevó por delante **Apla-ud-ir**, que tiene esas
cuatro letras dentro. Cuatro frases dejaron de aplicarse. Sin el aviso, se
habrían quedado cortas para siempre.

---

## Ver las escondidas

En el buscador, `#hidden` delante de lo que busques:

```
laud            busca entre las que se ven
#hidden laud    busca también entre las escondidas
```

Salen marcadas «·escondida» y atenuadas, y **no cuentan** para los números: lo
que dicen los contadores es cuántas puedes usar, y eso no cambia porque mires
detrás.

Es una palabra entera y no un signo suelto a propósito: con solo `#`, teclearlo
sin querer llenaba la lista de cosas que no deberían estar. Y no se anuncia en
ningún sitio — si es una puerta de servicio, no lleva cartel.
