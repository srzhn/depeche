<#
.SYNOPSIS
  Разворачивает depeche (говорилку) на ГОЛОМ сервере (чистая Ubuntu/Debian) с Windows-машины по SSH.

.DESCRIPTION
  Подключается к серверу, при необходимости ставит git, клонирует репозиторий и запускает
  scripts/provision.sh, который делает всё остальное: swap, Docker, docker compose, .env
  (с генерацией TURN-секрета) и запуск контейнеров. Повторный запуск безопасен.

  Пароль в скрипте НЕ хранится — запрашивается при запуске (Get-Credential).
  Вместо пароля можно заранее настроить вход по SSH-ключу (тогда просто нажми Enter в поле пароля,
  если ключ уже добавлен — Posh-SSH подхватит агент... либо используй ssh напрямую).

.PARAMETER Server
  IP или хост сервера. Обязательный.

.PARAMETER User
  Пользователь SSH (по умолчанию root).

.PARAMETER Domain
  Свой домен. Если не задан — используется <публичный-IP>.sslip.io (бесплатно, с HTTPS).

.PARAMETER Repo
  URL git-репозитория с проектом.

.PARAMETER Dir
  Каталог на сервере (по умолчанию /opt/depeche).

.EXAMPLE
  .\deploy.ps1 -Server 1.2.3.4

.EXAMPLE
  .\deploy.ps1 -Server 1.2.3.4 -Domain voice.example.com
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User   = 'root',
  [string]$Domain = '',
  [string]$Repo   = 'https://github.com/srzhn/depeche.git',
  [string]$Dir    = '/opt/depeche'
)

$ErrorActionPreference = 'Stop'

Write-Host "== Развёртывание depeche на $User@$Server ==" -ForegroundColor Cyan

# Пароль/креды спрашиваем безопасно и нигде не сохраняем.
$cred = Get-Credential -UserName $User -Message "Пароль SSH для $User@$Server"

# Модуль Posh-SSH — для подключения с паролем без интерактива внутри сессии.
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
  Write-Host "Ставлю модуль Posh-SSH (разово)..." -ForegroundColor Yellow
  try { Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -ErrorAction Stop } catch {}
  Install-Module -Name Posh-SSH -Scope CurrentUser -Force -AllowClobber
}
Import-Module Posh-SSH

$session = New-SSHSession -ComputerName $Server -Credential $cred -AcceptKey -ConnectionTimeout 30
try {
  $domainEnv = if ($Domain) { "DOMAIN='$Domain' " } else { "" }

  # Бутстрап голого сервера: git -> clone/pull -> provision.sh
  $remote = @"
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v git >/dev/null 2>&1; then
  (apt-get update -qq && apt-get install -y -qq git) || { yum install -y git; }
fi
if [ -d '$Dir/.git' ]; then
  echo '==> Обновляю репозиторий'
  git -C '$Dir' pull --ff-only
else
  echo '==> Клонирую репозиторий'
  git clone --depth 1 '$Repo' '$Dir'
fi
cd '$Dir'
chmod +x scripts/*.sh
$domainEnv./scripts/provision.sh
"@

  Write-Host "Выполняю установку на сервере (может занять несколько минут)..." -ForegroundColor Yellow
  $result = Invoke-SSHCommand -SessionId $session.SessionId -Command $remote -TimeOut 1200
  $result.Output
  Write-Host "`nEXIT: $($result.ExitStatus)" -ForegroundColor $(if ($result.ExitStatus -eq 0) { 'Green' } else { 'Red' })
}
finally {
  Remove-SSHSession -SessionId $session.SessionId | Out-Null
}
