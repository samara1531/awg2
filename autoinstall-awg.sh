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
wget -qO releases.json "$API"

NUM_RELEASES="$(jsonfilter -i releases.json -e '@#')"

ZIP_URL=""
i=0
while [ $i -lt $NUM_RELEASES ]; do
  TAG="$(jsonfilter -i releases.json -e "@[$i].tag_name")"
  if [ "$TAG" = "$REL" ]; then
    ASSETS="$(jsonfilter -i releases.json -e "@[$i].assets[*].browser_download_url")"
    # ищем URL с нашим target
    for URL in $ASSETS; do
      echo "$URL" | grep -q "$TARGET_DASH" && ZIP_URL="$URL" && break
    done
    break
  fi
  i=$((i+1))
done

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  exit 1
fi

echo "[+] Found zip:"
echo "    $ZIP_URL"

# --- download ---
wget -O awg.zip "$ZIP_URL"

# --- unzip ---
if command -v unzip >/dev/null 2>&1; then
  unzip -o awg.zip
elif busybox unzip >/dev/null 2>&1; then
  busybox unzip -o awg.zip
else
  echo "❌ unzip not available"
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
