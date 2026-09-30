# -*- coding: utf-8 -*-
u"""Los dibujos de los iconos: un <path> por icono, lienzo de 24x24.

Silueta blanca, plana, sin contornos ni degradados ni dos tonos. Un solo path
cada uno para que se puedan meter tal cual en el SVG de la rueda y en las filas
de la lista, sin cargar nada de fuera: en la pagina de Skyrim no hay red.

Los huecos —los ojos de la calavera, el aro de los grilletes— se hacen con
fill-rule evenodd, que es por eso que el path lleva subcaminos dentro.

Cual le toca a cada animacion lo decide iconos.py.
"""

DIBUJOS = {

    # Espada de una mano: hoja corta, guarda y pomo.
    'espada':
        'M12 3.4 13.4 6.4v7.8h-2.8V6.4z'
        'M8.4 14.8h7.2v2H8.4z'
        'M11.2 17.4h1.6v2.2h-1.6z'
        'M12 19.2a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z',

    # Calavera: craneo, mandibula, y los ojos y la nariz como huecos.
    'calavera':
        'M12 1.6c-4.5 0-8.1 3.6-8.1 8.1 0 2.6 1.2 4.9 3.1 6.4v2.6'
        'c0 1.7 1.4 3.1 3.1 3.1h3.8c1.7 0 3.1-1.4 3.1-3.1v-2.6'
        'c1.9-1.5 3.1-3.8 3.1-6.4 0-4.5-3.6-8.1-8.1-8.1z'
        'M9.2 7.7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'
        'M14.8 7.7a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'
        'M12 13.2l1.3 2.4h-2.6z',

    # Escudo: contorno en punta abajo.
    'escudo':
        'M12 1.6 3.8 4.2v7.2c0 5.1 3.4 8.8 8.2 10.9 4.8-2.1 8.2-5.8 '
        '8.2-10.9V4.2z',

    # Chispa de magia: estrella de cuatro puntas y dos chispas.
    'chispa':
        'M12 1.5l1.9 5.9 5.9 1.9-5.9 1.9L12 17.1l-1.9-5.9-5.9-1.9 5.9-1.9z'
        'M19.4 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z'
        'M5 16.6l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6z',

    # Cama de perfil: cabecero, colchon, patas y la almohada.
    'cama':
        'M2 6.4h2.3v6.2H21c.6 0 1 .4 1 1v6.1h-2.3v-4.9H4.3V19.7H2z'
        'M6.5 8.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',

    # Silla de frente: respaldo, asiento y cuatro patas. De perfil
    # siempre salia una "h", por grueso que se dibujara el trazo.
    'silla':
        'M6.2 1.8h11.6c.9 0 1.6.7 1.6 1.6v8.2H4.6V3.4c0-.9.7-1.6 1.6-1.6z'
        'M3 12.4h18v3.2H3z'
        'M4.6 16.4h2.8v5.8H4.6z'
        'M16.6 16.4h2.8v5.8h-2.8z',

    # Tenedor y cuchillo. El tenedor valia; el cuchillo se rehizo, que el
    # anterior no parecia un cuchillo sino una mancha.
    'cubiertos':
        'M4.4 1.9h1.7v5.4h.8V1.9h1.7v5.4h.8V1.9h1.7v6.2'
        'c0 1.2-.8 2.2-1.9 2.5V22.1H6.3V10.6c-1.1-.3-1.9-1.3-1.9-2.5z'
        'M17.1 1.9c1.5 2.1 2.3 4.6 2.3 7.1 0 1.7-.4 3.2-1.2 4.4h-1.1V1.9z'
        'M16.3 13.4h1.8V22.1h-1.8z',

    # Libro abierto: dos paginas y el lomo.
    'libro':
        'M2 4.1c2.9-.9 6.1-.9 9 .6v15.2c-2.9-1.5-6.1-1.5-9-.6z'
        'M22 4.1v15.2c-2.9-.9-6.1-.9-9 .6V4.7c2.9-1.5 6.1-1.5 9-.6z',

    # Corchea suelta: cabeza, palo y UNA bandera. La cabeza monta sobre el
    # palo a proposito —el palo baja hasta dentro de ella—: apenas tocandose
    # se veia como dos piezas sueltas.
    'nota':
        'M10.2 14.1a4 3.3 0 1 0 0 6.6 4 3.3 0 0 0 0-6.6z'
        'M11.9 3.1h2.5v14.8h-2.5z'
        'M14.4 2.8c3 1.7 5.4 3.7 5.4 6.6 0 1.9-1 3.5-2.6 4.5.6-1.3.6-2.5'
        '.1-3.6-.7-1.7-1.8-2.8-2.9-3.8z',

    # Vela encendida: llama y cuerpo.
    'vela':
        'M12 1.5c1.7 1.8 2.6 3.2 2.6 4.5 0 1.4-1.2 2.6-2.6 2.6'
        'S9.4 7.4 9.4 6c0-1.3.9-2.7 2.6-4.5z'
        'M9.2 9.9h5.6c.6 0 1.1.5 1.1 1.1v10c0 .6-.5 1.1-1.1 1.1H9.2'
        'c-.6 0-1.1-.5-1.1-1.1V11c0-.6.5-1.1 1.1-1.1z',

    # Caja: tapa en perspectiva y los dos costados.
    'caja':
        'M12 1.8 2.3 6.3 12 10.8l9.7-4.5z'
        'M2 8.2l9 4.2v9.4L2 17.6z'
        'M13 12.4l9-4.2v9.4l-9 4.2z',

    # Grilletes: los dos aros y la cadena en medio.
    'grilletes':
        'M6.2 7.6a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z'
        'M6.2 10.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'
        'M17.8 7.6a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6z'
        'M17.8 10.2a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z'
        'M10.6 11.3h2.8v2.2h-2.8z',

    # Bocadillo de dialogo.
    'bocadillo':
        'M3.3 3.9h17.4c1 0 1.8.8 1.8 1.8v8.8c0 1-.8 1.8-1.8 1.8H9.9'
        'l-4.8 4.1v-4.1H3.3c-1 0-1.8-.8-1.8-1.8V5.7c0-1 .8-1.8 1.8-1.8z',

    # Mano abierta saludando.
    'mano':
        'M12 1.9c-.7 0-1.3.6-1.3 1.3v6.2H9.5V4.5c0-.7-.6-1.3-1.3-1.3'
        's-1.3.6-1.3 1.3v7.4H5.7V7c0-.7-.6-1.3-1.3-1.3S3.1 6.3 3.1 7v8.2'
        'c0 3.8 3.1 6.9 6.9 6.9h2.6c3.8 0 6.9-3.1 6.9-6.9V8.2'
        'c0-.7-.6-1.3-1.3-1.3s-1.3.6-1.3 1.3v3.7h-1.2V4.5'
        'c0-.7-.6-1.3-1.3-1.3S14 3.8 14 4.5v4.9h-1.2V3.2c0-.7-.6-1.3-1.3-1.3z',

    # Cruz de sanidad: todo lo de heridas, dolor y muerte en vida.
    'cruz':
        'M9.2 1.8h5.6v7.4h7.4v5.6h-7.4v7.4H9.2v-7.4H1.8V9.2h7.4z',

    # Martillo: cabeza ancha centrada y mango recto. Se probo con la una a
    # un lado y el mango descentrado, mas fiel a un martillo de verdad,
    # pero centrado se lee mejor y es lo que se eligio al verlo.
    'martillo':
        'M4.2 3.2h15.6c.7 0 1.3.6 1.3 1.3v4.2c0 .7-.6 1.3-1.3 1.3H4.2'
        'c-.7 0-1.3-.6-1.3-1.3V4.5c0-.7.6-1.3 1.3-1.3z'
        'M10.3 10.6h3.4v11.6h-3.4z',

    # Copa: cuenco, pie y base. Toda la bebida.
    'copa':
        'M5.9 2.2h12.2l-.7 5.2c-.3 2.4-2.1 4.3-4.4 4.7v7.4h3.4'
        'c.6 0 1.1.5 1.1 1.1s-.5 1.1-1.1 1.1H7.6c-.6 0-1.1-.5-1.1-1.1'
        's.5-1.1 1.1-1.1H11v-7.4C8.7 11.7 6.9 9.8 6.6 7.4z',

    # Mandoble: la misma idea que la espada pero mas larga, mas ancha y con la
    # guarda mas abierta, para que se distingan de un vistazo puestas al lado.
    'mandoble':
        'M12 1.4 13.9 5v9.6h-3.8V5z'
        'M5.6 15.2h12.8v2.2H5.6z'
        'M11 18h2v2.4h-2z'
        'M12 20a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z',
}
