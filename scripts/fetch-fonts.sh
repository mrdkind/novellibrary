#!/usr/bin/env bash
# fetch-fonts.sh — دانلود فونت‌های جدید برای کتاب‌خوان روایت بی‌پایان
# منبع‌ها: مخازن رسمی فونت‌های فارسی (OFL) از طریق jsdelivr و گیت‌هاب
set -u
FDIR="$(cd "$(dirname "$0")/.." && pwd)/public/fonts"
mkdir -p "$FDIR"

fetch() { # fetch <url> <output-file>
  local url="$1" out="$FDIR/$2"
  if [ -s "$out" ]; then echo "• موجود است: $2"; return 0; fi
  echo "↓ دانلود $2 …"
  if curl -f -s -L --max-time 120 --retry 2 -o "$out" "$url"; then
    local size; size=$(stat -c%s "$out" 2>/dev/null || echo 0)
    if [ "$size" -lt 10000 ]; then echo "  ✗ فایل خیلی کوچک است ($size بایت) — حذف"; rm -f "$out"; return 1; fi
    echo "  ✓ $2 ($(( size / 1024 )) KB)"
  else
    echo "  ✗ ناموفق: $url"; rm -f "$out"; return 1
  fi
}

# ۱) میخک — امین عابدی (OFL) — مدرن و شکیل
fetch "https://cdn.jsdelivr.net/gh/aminabedi68/Mikhak@master/fonts/webfonts/statics/Mikhak-Regular.woff2" "Mikhak-Regular.woff2"
fetch "https://cdn.jsdelivr.net/gh/aminabedi68/Mikhak@master/fonts/webfonts/statics/Mikhak-Bold.woff2" "Mikhak-Bold.woff2"

# ۲) گندم — صابر راستی‌کردار (OFL) — بهینه برای مطالعه روی صفحه
fetch "https://cdn.jsdelivr.net/gh/rastikerdar/gandom-font@master/dist/Gandom.woff2" "Gandom-Regular.woff2"

# ۳) پرستو — صابر راستی‌کردار (OFL) — حال‌وهوای سریف کتابی
fetch "https://cdn.jsdelivr.net/gh/rastikerdar/parastoo-font@master/dist/Parastoo.woff2" "Parastoo-Regular.woff2"
fetch "https://cdn.jsdelivr.net/gh/rastikerdar/parastoo-font@master/dist/Parastoo-Bold.woff2" "Parastoo-Bold.woff2"

# ۴) صمیم — صابر راستی‌کردار (OFL) — تمیز و خوانا
fetch "https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@master/dist/Samim.woff2" "Samim-Regular.woff2"
fetch "https://cdn.jsdelivr.net/gh/rastikerdar/samim-font@master/dist/Samim-Bold.woff2" "Samim-Bold.woff2"

# ۵) شهرزاد جدید — SIL (OFL) — نسخ سنتی کتابی
fetch "https://raw.githubusercontent.com/google/fonts/main/ofl/scheherazadenew/ScheherazadeNew-Regular.ttf" "ScheherazadeNew-Regular.ttf"
fetch "https://raw.githubusercontent.com/google/fonts/main/ofl/scheherazadenew/ScheherazadeNew-Bold.ttf" "ScheherazadeNew-Bold.ttf"

# ۶) نستعلیق — Noto Nastaliq Urdu (OFL) — خوشنویسی نستعلیق برای ادبیات
fetch "https://raw.githubusercontent.com/google/fonts/main/ofl/notonastaliqurdu/NotoNastaliqUrdu%5Bwght%5D.ttf" "NotoNastaliqUrdu-Variable.ttf"

echo "---- فونت‌های نهایی ----"
ls -la "$FDIR" | awk '{print $5, $9}'
