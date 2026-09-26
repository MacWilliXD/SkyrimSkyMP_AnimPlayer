<#
.SYNOPSIS
    Instala AnimPlayer en el Skyrim con SkyMP de esta maquina.

.DESCRIPTION
    Copia plugin\animplayer.js y plugin\animplayer-settings.txt a
    Data\Platform\PluginsDev.

    Se usa PluginsDev y no Plugins a proposito: Plugins la gestionan los
    lanzadores a partir de su manifiesto, y lo que pongas ahi te lo pueden
    borrar en la siguiente actualizacion. PluginsDev es la carpeta para plugins
    propios, y si no existe se crea (el ejemplo oficial de SkyrimPlatform hace
    justo eso).

    Los ajustes NO se pisan si ya estan puestos, para no borrar la tecla o las
    animaciones que hayas anadido. Con -Ajustes se fuerza.

.PARAMETER Skyrim
    Carpeta de Skyrim Special Edition. Si no se pasa, se busca sola.

.PARAMETER Ajustes
    Sobrescribe tambien animplayer-settings.txt.

.EXAMPLE
    .\instalar.ps1
    .\instalar.ps1 -Skyrim "D:\Juegos\Skyrim Special Edition"
    .\instalar.ps1 -Ajustes
#>
[CmdletBinding()]
param(
    [string] $Skyrim,
    [switch] $Ajustes
)

$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path

function Buscar-Skyrim {
    # Los sitios de siempre, y despues lo que diga el registro de Steam.
    $candidatos = @(
        "${env:ProgramFiles(x86)}\Steam\steamapps\common\Skyrim Special Edition",
        "$env:ProgramFiles\Steam\steamapps\common\Skyrim Special Edition",
        "C:\Steam\steamapps\common\Skyrim Special Edition",
        "D:\Steam\steamapps\common\Skyrim Special Edition",
        "D:\SteamLibrary\steamapps\common\Skyrim Special Edition",
        "E:\SteamLibrary\steamapps\common\Skyrim Special Edition"
    )
    foreach ($c in $candidatos) {
        if (Test-Path (Join-Path $c 'SkyrimSE.exe')) { return $c }
    }

    $clave = 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam'
    if (Test-Path $clave) {
        $steam = (Get-ItemProperty $clave).InstallPath
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (Test-Path $vdf) {
            # En el vdf las rutas salen entre comillas; no hace falta un lector
            # de verdad para sacarlas.
            foreach ($linea in Get-Content $vdf) {
                if ($linea -match '"path"\s+"(.+?)"') {
                    $ruta = $Matches[1] -replace '\\\\', '\'
                    $c = Join-Path $ruta 'steamapps\common\Skyrim Special Edition'
                    if (Test-Path (Join-Path $c 'SkyrimSE.exe')) { return $c }
                }
            }
        }
    }
    return $null
}

if (-not $Skyrim) { $Skyrim = Buscar-Skyrim }

if (-not $Skyrim -or -not (Test-Path (Join-Path $Skyrim 'SkyrimSE.exe'))) {
    Write-Host 'No encuentro Skyrim Special Edition.' -ForegroundColor Red
    Write-Host 'Pasalo a mano:  .\instalar.ps1 -Skyrim "D:\ruta\Skyrim Special Edition"'
    exit 1
}
Write-Host "Skyrim:      $Skyrim"

$plataforma = Join-Path $Skyrim 'Data\Platform'
if (-not (Test-Path $plataforma)) {
    Write-Host 'Ese Skyrim no lleva SkyrimPlatform instalado.' -ForegroundColor Red
    Write-Host 'AnimPlayer necesita SkyrimPlatform (viene con SkyMP): falta Data\Platform.'
    exit 1
}

$destino = Join-Path $plataforma 'PluginsDev'
if (-not (Test-Path $destino)) {
    New-Item -ItemType Directory -Force -Path $destino | Out-Null
    Write-Host "PluginsDev:  creada"
}
Write-Host "Destino:     $destino"
Write-Host ''

$origenPlugin = Join-Path $aqui 'plugin\animplayer.js'
$origenAjustes = Join-Path $aqui 'plugin\animplayer-settings.txt'
foreach ($f in @($origenPlugin, $origenAjustes)) {
    if (-not (Test-Path $f)) {
        Write-Host "Falta $f" -ForegroundColor Red
        exit 1
    }
}

Copy-Item $origenPlugin -Destination $destino -Force
$tam = [math]::Round((Get-Item $origenPlugin).Length / 1KB)
Write-Host "  copiado  animplayer.js   ($tam KB)" -ForegroundColor Green

$ajustesPuestos = Join-Path $destino 'animplayer-settings.txt'
if ((Test-Path $ajustesPuestos) -and (-not $Ajustes)) {
    Write-Host '  respetado animplayer-settings.txt (ya estaba; -Ajustes lo pisa)' -ForegroundColor DarkYellow
} else {
    Copy-Item $origenAjustes -Destination $destino -Force
    Write-Host '  copiado  animplayer-settings.txt' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Listo. Entra al servidor y pulsa F3.' -ForegroundColor Cyan
Write-Host 'Si no sale nada, abre la consola del juego con ~ y busca lineas [animplayer].'
