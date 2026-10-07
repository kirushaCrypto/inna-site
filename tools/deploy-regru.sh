#!/usr/bin/env bash
# Выкладка на хостинг Рег.ру (u3675325, ISPmanager, ssh-хост innasofia из ~/.ssh/config, вход по ключу).
#   bash tools/deploy-regru.sh            # домен по умолчанию innasofia.ru
# Новая версия распаковывается рядом и подменяет папку сайта целиком, старая уходит в ~/_backup/
# (хранятся 3 последних). Откат: ssh innasofia, переложить нужный бэкап обратно в ~/www/<домен>.
set -euo pipefail
DOMAIN="${1:-innasofia.ru}"
cd "$(dirname "$0")/.."

python tools/build.py "$DOMAIN" regru

tar -C dist -czf - . | ssh innasofia "set -e
d=~/www/$DOMAIN
test -d \$d || { echo \"Нет папки \$d: домен не привязан к хостингу в ISPmanager\"; exit 1; }
new=~/www/.$DOMAIN.new
rm -rf \$new && mkdir -p \$new ~/_backup
tar -xzf - -C \$new
chmod 755 \$new
mv \$d ~/_backup/$DOMAIN-\$(date +%F-%H%M%S) && mv \$new \$d
ls -1dt ~/_backup/$DOMAIN-* | tail -n +4 | xargs -r rm -rf
ls -la \$d"

# Пока DNS домена не разошёлся, проверяем прямо по IP сервера.
IP=31.31.198.114
via=""
python -c "import socket, sys; socket.gethostbyname(sys.argv[1])" "$DOMAIN" 2>/dev/null || via="--resolve $DOMAIN:80:$IP --resolve $DOMAIN:443:$IP --resolve www.$DOMAIN:80:$IP --resolve www.$DOMAIN:443:$IP"
echo "Проверка${via:+ (по IP $IP: DNS домена ещё нет, сертификат не проверяется)}:"
for url in "https://$DOMAIN/" "http://$DOMAIN/" "http://www.$DOMAIN/" "https://www.$DOMAIN/" "https://$DOMAIN/video/inna-visitka.mp4"; do
  # shellcheck disable=SC2086
  code=$(curl -sI --noproxy '*' --max-time 15 ${via:+-k} $via -o /dev/null -w '%{http_code} %{redirect_url}' "$url") || code="нет ответа"
  echo "  $url -> $code"
done
