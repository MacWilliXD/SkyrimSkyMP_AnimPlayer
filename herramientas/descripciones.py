# -*- coding: utf-8 -*-
u"""Las descripciones que se quedaban en dos palabras.

EL PROBLEMA
  85 de las 227 aceptadas tenian una descripcion de menos de cinco palabras, y
  muchas eran el nombre repetido: "Llorar :: Empezar a llorar", "Aplaudir ::
  Aplaudir", "Bailar (A) :: Baile". Eso no describe nada; quien lee la ficha ya
  sabe como se llama, lo que quiere saber es que va a ver.

LO QUE SE HACE
  Una frase por animacion, escrita a mano. No hay forma de generar esto con
  reglas: "Reirse (A)" y "Reirse (E)" se llaman casi igual y son dos
  animaciones distintas, y lo unico que las separa es lo que hace el personaje.

  Todas empiezan por infinitivo, como las demas, y cuentan lo que se ve: que
  mueve, con que mano, de pie o agachado.

DE PASO SE ARREGLAN LAS ERRATAS QUE HABIA
      "Alimentarse y del suelo"      sobraba la y
      "Mostrar una posicón grande"   era poción
      "Pose de estar centado"        sentado
      "Acostarse y retorserse"       retorcerse
      "Rebuscar en el cofre"         en la ficha de "Rebuscar en el suelo"

  Van aqui y no en una lista de erratas aparte porque la frase se reescribe
  entera: corregir la errata y escribir la descripcion son el mismo trabajo.
"""

# Por NOMBRE, que es con lo que uno razona al leerlas. Si un nombre de aqui no
# existe en la hoja, pulir-hoja.py avisa.
LARGAS = {
    # --------------------------------------------------------------- batalla
    u"Retroceder por golpe (C)": u"Retroceder un paso al recibir un golpe",
    u"Revisar arma (En guardia)": u"Mirar el filo del arma desenvainada",
    u"Limpiar espada": u"Pasar un trapo por el filo de la espada",
    u"Cortar las ataduras": u"Cortar las cuerdas que atan las manos",
    u"Estar herido (A)": u"Sujetarse el hombro herido con la otra mano",
    u"Estar herido (C)": u"Tirarse al suelo y retorcerse de dolor",
    u"Estar herido (D)": u"Caer de rodillas sujetándose la herida",
    u"Estar atado de pie": u"Esperar de pie con las manos atadas",

    # ---------------------------------------------------------- comer y beber
    u"Alimentarse del suelo (A)":
        u"Agacharse a morder un cuerpo tendido en el suelo",
    u"Alimentarse del suelo (B)":
        u"Inclinarse sobre un cuerpo en el suelo para alimentarse",
    u"Beber de taza (A)": u"Levantar una taza y beber de ella",
    u"Dejar de Tambalear": u"Recuperar el equilibrio y dejar de tambalearse",
    u"Morder el cuello": u"Sujetar a alguien y morderle el cuello",
    u"Tambalear (A)": u"Perder el equilibrio y empezar a tambalearse",
    u"Tambalear (B)": u"Tambalearse de lado a lado sin caerse",

    # ---------------------------------------------------------- gestos y voz
    u"Mostrar algo": u"Señalar algo con la mano para mostrarlo",
    u"Dar cabezadas": u"Cabecear de sueño sin llegar a dormirse",
    u"Reirse (A)": u"Soltar una carcajada burlona echando la cabeza atrás",
    u"Reirse (E)": u"Reírse con ganas llevándose la mano al pecho",
    u"Calentarse los brazos": u"Frotarse los brazos para entrar en calor",
    u"Dejar de llorar": u"Serenarse y dejar de llorar poco a poco",
    u"Encogerse de miedo": u"Encogerse y cubrirse la cara con miedo",
    u"Gesticular alterado": u"Mover mucho las manos hablando alterado",
    u"Presentar respeto": u"Inclinar el cuerpo despacio en señal de respeto",
    u"Jugar con una muñeca": u"Sostener una muñeca de trapo y jugar con ella",
    u"Llamar la atención": u"Agitar el brazo para llamar la atención de alguien",
    u"Llorar": u"Taparse la cara y romper a llorar",
    u"Avergonzarse (C)": u"Bajar la cabeza y encogerse de vergüenza",
    u"Arrodillarse de verguenza": u"Arrodillarse cabizbajo, avergonzado ante alguien",
    u"Rabiar con patadas": u"Patear el suelo en pleña rabieta",
    u"Patalear con rabia": u"Dar patadas al aire con rabia",
    u"Saludar con la mano": u"Levantar el brazo y sacudir la mano saludando",
    u"Secarse la frente": u"Pasarse el brazo por la frente sudada",
    u"Señalar algo (A)": u"Señalar con el brazo algo a media distancia",
    u"Señalar algo (B)": u"Estirar el brazo señalando algo lejano",
    u"Señalar algo (C)": u"Señalar con el dedo algo que tiene cerca",
    u"Reverenciar": u"Hacer una reverencia inclinando el cuerpo",
    u"Toser": u"Toser con fuerza sin poder parar",
    u"Quejarse": u"Quejarse en voz alta moviendo los brazos",
    u"Observar": u"Quedarse quieto observando algo con atención",

    # ------------------------------------------------------- musica y fiesta
    u"Aplaudir (A)": u"Aplaudir con un ritmo normal",
    u"Aplaudir (B)": u"Aplaudir despacio, con las manos separadas",
    u"Aplaudir (C)": u"Aplaudir deprisa y con mucha emoción",
    u"Aplaudir (E)": u"Aplaudir sin ganas, con poca fuerza",
    u"Bailar (A)": u"Bailar dando vueltas con los brazos sueltos",
    u"Bailar (B)": u"Bailar moviendo los hombros y los pies",
    u"Bailar (C)": u"Bailar saltando de un pie a otro",
    u"Celebrar (A)": u"Levantar los dos brazos celebrando algo",
    u"Celebrar (B)": u"Alzar los brazos y celebrar con fuerza",
    u"Celebrar (C)": u"Abrir los brazos celebrando hacia los lados",
    u"Celebrar (D)": u"Celebrar levantando los puños al aire",
    u"Celebrar (E)": u"Celebrar agitando los dos brazos en alto",
    u"Tocar el laúd": u"Sacar un laúd y tocarlo de pie",
    u"Tocar el tambor": u"Sostener un tambor y golpearlo con la mano",
    u"Tocar la flauta": u"Llevarse una flauta a la boca y tocar",

    # ------------------------------------------------------------- magia
    u"Rezar en cuclillas": u"Ponerse en cuclillas y rezar en silencio",

    # ------------------------------------------------------------- oficios
    u"Agarrar algo": u"Estirar el brazo y agarrar algo cercano",
    u"Cortar leña": u"Partir leña a hachazos sobre el tocón",
    u"Lanzar flores": u"Sacar flores del cesto y lanzarlas al aire",
    u"Dejar la leña": u"Agacharse y dejar la leña en el suelo",
    u"Dejar una piedra": u"Agacharse y dejar una piedra en el suelo",
    u"Entregar algo (A)": u"Acercarse y entregar algo con las dos manos",
    u"Entregar algo (B)": u"Tender el brazo para entregar algo",
    u"Entregar cuerno tallado": u"Ofrecer un cuerno tallado con las dos manos",
    u"Escribir en el registro": u"Escribir en un libro de cuentas abierto",
    u"Forzar una cerradura": u"Agacharse a forzar una cerradura con ganzúa",
    u"Llevar una olla": u"Cargar una olla grande con las dos manos",
    u"Inyectarse extractor": u"Clavarse un extractor enano en el brazo",
    u"Picar con el pico (A)": u"Golpear la roca con un pico",
    u"Rebuscar en el suelo": u"Agacharse a rebuscar dentro de un cofre",
    u"Rebuscar en la mesa (A)": u"Revolver lo que hay sobre la mesa",
    u"Recoger algo": u"Recoger algo sin llegar a agacharse",
    u"Recoger algo del suelo (A)": u"Agacharse a recoger algo del suelo",
    u"Recoger algo del suelo (C)":
        u"Ponerse de rodillas para recoger algo del suelo",
    u"Recoger leña": u"Agacharse a recoger leña del suelo",
    u"Servir de la olla": u"Servir con un cucharón de la olla",
    u"Tirar de algo": u"Tirar de algo pesado hacia delante",
    u"Trabajar en la forja": u"Golpear el hierro al rojo en la forja",
    u"Mostrar poción": u"Levantar una poción grande para enseñarla",
    u"Abrir una puerta": u"Empujar una puerta para abrirla",
    u"Empujar una palanca": u"Empujar una palanca con las dos manos",
    u"Vaciar una cubeta": u"Volcar una cubeta para vaciarla",

    # --------------------------------------------------- sentarse y descansar
    u"Cambiar de pose (Sentado) (A)": u"Cambiar de postura estando sentado",
    u"Cambiar de pose (Sentado) (B)":
        u"Acomodarse en el asiento cambiando de postura",
    u"Acostarse en el suelo": u"Tumbarse en el suelo boca arriba",
}

MINIMO = 5


def esPobre(texto):
    u"""Si la descripcion se queda corta para describir algo."""
    return len((texto or u"").split()) < MINIMO
