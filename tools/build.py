"""Сборка сайта под конкретный адрес.

    python tools/build.py innasofia.ru regru      -> dist/ для хостинга Рег.ру (+ .htaccess)
    python tools/build.py innasofia.ru beget      -> dist/ для Beget (+ .htaccess)
    python tools/build.py inna-sofia.netlify.app netlify
    python tools/build.py innasofia.ru redirect   -> dist/ только с _redirects: старый адрес на Netlify шлёт 301 на домен

Что делает: копирует нужные файлы в dist/, ставит домен вместо SITE_DOMAIN,
дату выкладки в sitemap и собирает разметку FAQPage из видимых вопросов на странице,
чтобы разметка и текст не разъехались.
"""
import datetime
import html
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
PARTS = ["index.html", "favicon.ico", "robots.txt", "sitemap.xml", "css", "fonts", "img", "js", "video"]

HTACCESS = """# Один адрес сайта: https и без www (301, чтобы поисковики склеили зеркала)
# За nginx Apache может не видеть https напрямую: «не https» — когда ни один признак не говорит https.
RewriteEngine On
RewriteCond %{{HTTPS}} !=on
RewriteCond %{{HTTP:X-Forwarded-Proto}} !=https
RewriteCond %{{SERVER_PORT}} !=443
RewriteRule ^(.*)$ https://{domain}/$1 [R=301,L]
RewriteCond %{{HTTP_HOST}} ^www\\. [NC]
RewriteRule ^(.*)$ https://{domain}/$1 [R=301,L]

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 7 days"
  ExpiresByType application/javascript "access plus 7 days"
  ExpiresByType image/jpeg "access plus 30 days"
  ExpiresByType image/webp "access plus 30 days"
  ExpiresByType font/woff2 "access plus 1 year"
  ExpiresByType video/mp4 "access plus 30 days"
</IfModule>
"""


def faq_jsonld(page: str) -> str:
    items = re.findall(
        r'<span class="faq__q">(.*?)</span>.*?<div class="faq__inner">(.*?)</div>', page, re.S)
    if not items:
        sys.exit("Не нашёл вопросы FAQ на странице")
    data = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": html.unescape(q.strip()),
             "acceptedAnswer": {"@type": "Answer", "text": html.unescape(re.sub(r"<[^>]+>", "", a).strip())}}
            for q, a in items
        ],
    }
    return '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, indent=2) + "\n</script>\n"


def main():
    if len(sys.argv) != 3 or sys.argv[2] not in ("regru", "beget", "netlify", "redirect"):
        sys.exit(__doc__)
    domain, target = sys.argv[1], sys.argv[2]
    today = datetime.date.today().isoformat()

    if target == "redirect":
        DIST.mkdir(exist_ok=True)
        for old in DIST.iterdir():
            shutil.rmtree(old) if old.is_dir() else old.unlink()
        (DIST / "_redirects").write_text(f"/*  https://{domain}/:splat  301!\n", encoding="utf-8", newline="\n")
        print(f"dist/ готов: 301 на https://{domain}/")
        return

    # Чистим содержимое, а не саму папку: на Windows её может держать локальный сервер.
    DIST.mkdir(exist_ok=True)
    for old in DIST.iterdir():
        shutil.rmtree(old) if old.is_dir() else old.unlink()
    for part in PARTS:
        src = ROOT / part
        (shutil.copytree if src.is_dir() else shutil.copy2)(src, DIST / part)

    for name in ("index.html", "robots.txt", "sitemap.xml"):
        f = DIST / name
        text = f.read_text(encoding="utf-8").replace("SITE_DOMAIN", domain)
        if name == "sitemap.xml":
            text = re.sub(r"<lastmod>.*?</lastmod>", f"<lastmod>{today}</lastmod>", text)
        if name == "index.html":
            text = text.replace("</head>", faq_jsonld(text) + "</head>", 1)
        f.write_text(text, encoding="utf-8", newline="\n")

    if target in ("regru", "beget"):
        (DIST / ".htaccess").write_text(HTACCESS.format(domain=domain), encoding="utf-8", newline="\n")

    left = [p for p in DIST.rglob("*") if p.is_file() and "SITE_DOMAIN" in p.read_text("utf-8", "ignore")]
    if left:
        sys.exit(f"Остался SITE_DOMAIN в {left}")
    print(f"dist/ готов: {domain} ({target}), lastmod {today}")


if __name__ == "__main__":
    main()
