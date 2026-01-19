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
if ! wget -qO releases.json "$API"; then
  echo "❌ Не удалось скачать информацию о релизах"
  exit 1
fi

# --- strict ZIP lookup: tag + target ---
ZIP_URL="$(grep -o \
  "https://github.com/$REPO/releases/download/$REL/[^\" ]*$TARGET_DASH[^\" ]*\.zip" \
  releases.json | head -n1)"

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  echo "Проверь релиз вручную:"
  echo "https://github.com/$REPO/releases/tag/$REL"
  exit 1
fi

echo "[+] Found zip:"
echo " $ZIP_URL"

# --- download ---
if ! wget -O awg.zip "$ZIP_URL"; then
  echo "❌ Не удалось скачать ZIP"
  exit 1
fi

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

# --- install packages ---
for pkg in \
  amneziawg-tools \
  amneziawg-go \
  luci-proto-amneziawg \
  luci-i18n-amneziawg-ru
do
  FILE="$(ls 2>/dev/null | grep "^$pkg-.*\.$PM$" | head -n1)"
  if [ -z "$FILE" ]; then
    echo "⚠ $pkg not found"
    continue
  fi

  echo "[+] Installing $FILE"
  if [ "$PM" = "apk" ]; then
    apk add --allow-untrusted "./$FILE" || true
  else
    opkg install "./$FILE" || true
  fi
done

echo "✅ AWG install finished"
