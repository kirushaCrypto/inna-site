#!/usr/bin/env bash
# Выкладка на Beget (аккаунт kiril76s, ssh-хост getcited из ~/.ssh/config).
#   bash tools/deploy-beget.sh innasofia.ru
# Сначала в панели Beget: «Сайты» -> добавить сайт <домен> и привязать к нему домен,
# тогда появится папка ~/<домен>/public_html. Старое содержимое уходит в ~/<домен>/_backup/.
set -euo pipefail
DOMAIN="${1:?Укажи домен: bash tools/deploy-beget.sh innasofia.ru}"
cd "$(dirname "$0")/.."

python tools/build.py "$DOMAIN" beget

tar -C dist -czf - . | ssh getcited "set -e
d=~/$DOMAIN/public_html
test -d \$d || { echo \"Нет папки \$d: сначала добавь сайт $DOMAIN в панели Beget\"; exit 1; }
mkdir -p ~/$DOMAIN/_backup
tar -czf ~/$DOMAIN/_backup/public_html-\$(date +%F-%H%M).tgz -C \$d .
find \$d -mindepth 1 -maxdepth 1 ! -name cgi-bin -exec rm -rf {} +
tar -xzf - -C \$d
ls -la \$d"

echo "Проверка:"
curl -s -o /dev/null -w "https://$DOMAIN/ -> %{http_code}\n" "https://$DOMAIN/" || true
curl -s -o /dev/null -w "http://www.$DOMAIN/ -> %{http_code} %{redirect_url}\n" "http://www.$DOMAIN/" || true
