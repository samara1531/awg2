#!/bin/sh
set -e

REPO="samara1531/awg2"
API="https://api.github.com/repos/$REPO/releases"

# OpenWrt info
. /etc/openwrt_release

REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"              # rockchip/armv8
TARGET_DASH="$(echo "$TARGET" | tr / -)"

echo "[*] OpenWrt release: $REL"
echo "[*] Target: $TARGET"

TMP="/tmp/awg"
rm -rf "$TMP"
mkdir -p "$TMP"
cd "$TMP"

echo "[*] Fetching releases info..."
wget -qO releases.json "$API"

# --- JSONFILTER ONLY ---
ZIP_URL="$(jsonfilter -i releases.json \
  -e '@.[][@.tag_name="'"$REL"'"].assets[*].browser_download_url' \
  | grep "$TARGET_DASH" \
  | head -n1)"

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  exit 1
fi

echo "[+] Found zip:"
echo "    $ZIP_URL"

wget -O awg.zip "$ZIP_URL"

# Extract
if command -v unzip >/dev/null 2>&1; then
  unzip -o awg.zip
else
  busybox unzip -o awg.zip
fi

cd awgrelease || {
  echo "❌ awgrelease directory missing"
  exit 1
}

# Detect package manager
if command -v apk >/dev/null 2>&1; then
  PM="apk"
  EXT="apk"
elif command -v opkg >/dev/null 2>&1; then
  PM="opkg"
  EXT="ipk"
else
  echo "❌ No package manager found"
  exit 1
fi

echo "[*] Installing packages via $PM"

for pkg in \
  amneziawg-tools \
  kmod-amneziawg \
  luci-proto-amneziawg \
  luci-i18n-amneziawg-ru
do
  FILE="$(ls | grep "^$pkg-.*\.$EXT$" | head -n1)"

  [ -z "$FILE" ] && {
    echo "⚠ $pkg not found"
    continue
  }

  echo "[+] Installing $FILE"

  if [ "$PM" = "apk" ]; then
    apk add --allow-untrusted "./$FILE"
  else
    opkg install "./$FILE"
  fi
done

echo "✅ AWG installed successfully"
