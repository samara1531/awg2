#!/bin/sh
set -e

REPO="samara1531/awg2"
API="https://api.github.com/repos/$REPO/releases"
TMP="/tmp/awg"
mkdir -p "$TMP"
cd "$TMP"

# --- OpenWrt info ---
. /etc/openwrt_release
REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"
TARGET_DASH="$(echo "$TARGET" | tr '/' '-')"
echo "[*] OpenWrt release: $REL"
echo "[*] Target: $TARGET"

# --- fetch releases ---
echo "[*] Fetching releases info..."
wget -qO releases.json "$API" || {
  echo "❌ Не удалось скачать информацию о релизах"
  exit 1
}

# --- Поиск подходящего ZIP через grep (без jsonfilter) ---
ZIP_URL=""
# Ищем строку с нужным тегом и потом ищем внутри ссылку с нашим target
RELEASE_BLOCK=$(grep -A 60 "\"tag_name\": \"$REL\"" releases.json || true)

if [ -n "$RELEASE_BLOCK" ]; then
  ASSETS=$(echo "$RELEASE_BLOCK" | grep -o 'https://[^"]*\.zip' | tr '\n' ' ' || true)
  for URL in $ASSETS; do
    if echo "$URL" | grep -q "$TARGET_DASH"; then
      ZIP_URL="$URL"
      break
    fi
  done
fi

if [ -z "$ZIP_URL" ]; then
  # Альтернативный поиск — просто по строке target (на случай если структура JSON другая)
  ZIP_URL=$(grep -o 'https://[^"]*'"$TARGET_DASH"'[^"]*\.zip' releases.json | head -n1 || true)
fi

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  echo "Попробуй посмотреть вручную: https://github.com/$REPO/releases/tag/$REL"
  exit 1
fi

echo "[+] Found zip:"
echo " $ZIP_URL"

# --- download ---
wget -O awg.zip "$ZIP_URL" || {
  echo "❌ Не удалось скачать ZIP"
  exit 1
}

# --- unzip ---
if command -v unzip >/dev/null 2>&1; then
  unzip -o awg.zip
elif busybox unzip >/dev/null 2>&1; then
  busybox unzip -o awg.zip
else
  echo "❌ unzip not available"
  echo "Установи: opkg update && opkg install unzip"
  exit 1
fi

cd awgrelease || {
  echo "❌ awgrelease directory missing"
  exit 1
}

# --- detect package manager ---
if command -v apk >/dev/null 2>&1; then
  PM=apk
elif command -v opkg >/dev/null 2>&1; then
  PM=opkg
else
  echo "❌ No package manager found"
  exit 1
fi

echo "[*] Installing packages via $PM"

# --- install packages ignoring version ---
for pkg in amneziawg-tools kmod-amneziawg luci-proto-amneziawg luci-i18n-amneziawg-ru; do
  FILE="$(ls 2>/dev/null | grep "^$pkg-.*\.$PM$" | head -n1)"
  if [ -z "$FILE" ]; then
    echo "⚠ $pkg not found"
    continue
  fi
  echo "[+] Installing $FILE"
  if [ "$PM" = "apk" ]; then
    apk add --allow-untrusted "./$FILE"
  else
    opkg install "./$FILE"
  fi
done

echo "✅ AWG installed successfully"
