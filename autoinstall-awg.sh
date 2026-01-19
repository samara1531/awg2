#!/bin/sh
set -e

REPO="samara1531/awg2"
API="https://api.github.com/repos/$REPO/releases"

# 1. OpenWrt info
. /etc/openwrt_release

REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"

echo "[*] OpenWrt release: $REL"
echo "[*] Target: $TARGET"

TMP="/tmp/awg"
mkdir -p "$TMP"
cd "$TMP"

# 2. Fetch releases
echo "[*] Fetching releases info..."
wget -qO releases.json "$API"

# 3. Extract download URL
ZIP_URL="$(grep -A50 "\"tag_name\": \"$REL\"" releases.json \
  | grep "browser_download_url" \
  | grep "-$TARGET-" \
  | head -n1 \
  | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')"

if [ -z "$ZIP_URL" ]; then
  echo "❌ No matching build for $REL / $TARGET"
  exit 1
fi

echo "[+] Found zip:"
echo "    $ZIP_URL"

# 4. Download zip
wget -O awg.zip "$ZIP_URL"

# 5. Extract
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

# 6. Detect package manager
if command -v apk >/dev/null 2>&1; then
  PM=apk
elif command -v opkg >/dev/null 2>&1; then
  PM=opkg
else
  echo "❌ No package manager"
  exit 1
fi

echo "[*] Installing packages via $PM"

# 7. Install packages ignoring version suffix
for pkg in amneziawg-tools kmod-amneziawg luci-proto-amneziawg luci-i18n-amneziawg-ru; do
  FILE="$(ls | grep "^$pkg-.*\.$PM$" | head -n1)"

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
