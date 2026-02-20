#!/bin/sh
# AWG auto installer (BusyBox / ash compatible)
# Работает с SNAPSHOT, строго берёт текущий tag

set -e

REPO="samara1531/awg2"
API="https://api.github.com/repos/$REPO/releases?per_page=100"
TMP="/tmp/awg"

mkdir -p "$TMP"
cd "$TMP" || exit 1

echo "[*] Detecting OpenWrt..."

# --- system info ---
. /etc/openwrt_release

REL="$DISTRIB_RELEASE"
TARGET="$DISTRIB_TARGET"
TARGET_DASH="$(echo "$TARGET" | tr '/' '-')"

echo "[*] OpenWrt release: $REL"
echo "[*] Target: $TARGET"

# --- fetch releases ---
echo "[*] Fetching releases info..."
wget -qO releases.json "$API" || {
    echo "❌ Failed to fetch releases"
    exit 1
}

# --- find ZIP strictly by current release tag + target ---
echo "[*] Searching matching build..."

ZIP_URL="$(cat releases.json \
 | tr ',' '\n' \
 | grep browser_download_url \
 | grep "/download/$REL/" \
 | grep "$TARGET_DASH" \
 | grep '.zip' \
 | head -n1 \
 | cut -d'"' -f4)"

if [ -z "$ZIP_URL" ]; then
    echo "❌ No matching build for:"
    echo "   release: $REL"
    echo "   target : $TARGET_DASH"
    echo
    echo "Debug:"
    echo "grep $TARGET_DASH releases.json"
    exit 1
fi

echo "[+] Found zip:"
echo "    $ZIP_URL"

# --- download ---
echo "[*] Downloading..."
wget -qO awg.zip "$ZIP_URL" || {
    echo "❌ ZIP download failed"
    exit 1
}

# --- unzip ---
if ! command -v unzip >/dev/null 2>&1; then
    echo "[*] Installing unzip..."
    opkg update >/dev/null 2>&1 || true
    opkg install unzip >/dev/null 2>&1 || true
fi

unzip -o awg.zip >/dev/null

cd awgrelease 2>/dev/null || {
    echo "❌ awgrelease directory missing"
    exit 1
}

# --- detect package manager ---
if command -v opkg >/dev/null 2>&1; then
    PM="opkg"
elif command -v apk >/dev/null 2>&1; then
    PM="apk"
else
    echo "❌ No package manager found"
    exit 1
fi

echo "[*] Installing packages via $PM"

INST_KMOD=0
INST_TOOLS=0
INST_LUCI=0

for pkg in \
    kmod-amneziawg \
    amneziawg-tools \
    luci-proto-amneziawg \
    luci-i18n-amneziawg-ru
do
    FILE="$(ls | grep "^$pkg-.*\.$PM$" | head -n1)"

    if [ -z "$FILE" ]; then
        echo "⚠ $pkg not found"
        continue
    fi

    echo "[+] Installing $FILE"

    if [ "$PM" = "opkg" ]; then
        opkg install "./$FILE" || true
    else
        apk add --allow-untrusted "./$FILE" || true
    fi

    case "$pkg" in
        kmod-amneziawg) INST_KMOD=1 ;;
        amneziawg-tools) INST_TOOLS=1 ;;
        luci-proto-amneziawg) INST_LUCI=1 ;;
    esac
done

echo
echo "✅ AWG installation finished"

if [ "$INST_KMOD" -eq 1 ] &&
   [ "$INST_TOOLS" -eq 1 ] &&
   [ "$INST_LUCI" -eq 1 ]; then
    echo
    echo "⚠ Reboot required to apply changes"
    echo "reboot"
fi
