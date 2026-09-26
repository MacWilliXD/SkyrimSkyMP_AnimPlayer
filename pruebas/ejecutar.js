/* Lanza la prueba del panel dentro de Electron.
 *
 * Existe para dos cosas que son faciles de olvidar y hacen que la prueba no
 * arranque sin decir por que:
 *
 *   1. ELECTRON_RUN_AS_NODE. Si esa variable esta puesta en el entorno (y a
 *      menudo lo esta), electron.exe se comporta como un node normal: no abre
 *      ventana, no hay app.whenReady, y la prueba se queda colgada. Hay que
 *      borrarla del entorno del hijo.
 *
 *   2. Electron no se lanza con argumentos sueltos. Se le pasa la CARPETA que
 *      contiene el package.json con "main", y nada mas. Cualquier argumento
 *      extra y no arranca, otra vez sin decir por que.
 *
 * Tambien busca el ejecutable, porque este proyecto no necesita Electron para
 * nada mas y no tiene sentido bajarse otra copia de 200 MB: se reutiliza la del
 * proyecto RolePlayHub, que esta al lado. Si no aparece, se puede indicar con
 *     ELECTRON=C:/ruta/a/electron.exe node pruebas/ejecutar.js
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const AQUI = __dirname;
const PROYECTOS = path.resolve(AQUI, '..', '..');

function buscarElectron() {
  if (process.env.ELECTRON && fs.existsSync(process.env.ELECTRON)) {
    return process.env.ELECTRON;
  }
  const candidatos = [
    path.join(AQUI, '..', 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(PROYECTOS, 'RolePlayHub', 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(PROYECTOS, 'RolePlayHub_SkyrimMod', 'node_modules', 'electron', 'dist', 'electron.exe')
  ];
  for (const c of candidatos) if (fs.existsSync(c)) return c;
  return null;
}

const electron = buscarElectron();
if (!electron) {
  console.error('No encuentro electron.exe. Opciones:');
  console.error('  npm i -D electron       (dentro de este proyecto)');
  console.error('  ELECTRON=C:/ruta/electron.exe node pruebas/ejecutar.js');
  process.exit(1);
}
console.log('Electron:', electron);
console.log();

const entorno = Object.assign({}, process.env);
delete entorno.ELECTRON_RUN_AS_NODE;      // si no, no abre ventana (ver arriba)

const r = spawnSync(electron, [AQUI], { stdio: 'inherit', env: entorno });
process.exit(r.status === null ? 1 : r.status);
