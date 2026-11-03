
#!/bin/sh
# AWG-Go auto installer (BusyBox / ash compatible)
# Работает с SNAPSHOT, строго берёт текущий tag
# unzip устанавливается автоматически при необходимости

set -e

REPO="samara1531/awg2"
API="https://api.github.com/repos/$REPO/releases?per_page=100"
TMP="/tmp/awg"

# --- cleanup при любом завершении ---
trap 'rm -rf "$TMP"' EXIT
trap 'exit 1' HUP INT TERM

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

# --- detect package manager ---
if command -v opkg >/dev/null 2>&1; then
    PM="opkg"
elif command -v apk >/dev/null 2>&1; then
    PM="apk"
else
    echo "❌ No package manager found"
    exit 1
fi

# --- install unzip if missing ---
INDEX_UPDATED=0

if ! command -v unzip >/dev/null 2>&1; then
    echo "[*] unzip not found, installing..."

    if [ "$PM" = "opkg" ]; then
        opkg update || echo "⚠ Failed to update opkg lists, continuing..."
        INDEX_UPDATED=1
        opkg install unzip || {
            echo "❌ Failed to install unzip"
            exit 1
        }
    else
        apk update || echo "⚠ Failed to update apk lists, continuing..."
        INDEX_UPDATED=1
        apk add unzip || {
            echo "❌ Failed to install unzip"
            exit 1
        }
    fi

    if ! command -v unzip >/dev/null 2>&1; then
        echo "❌ unzip installation failed"
        exit 1
    fi

    echo "[+] unzip installed successfully"
fi

# --- fetch releases ---
echo "[*] Fetching releases info..."
wget -qO releases.json "$API" || {
    echo "❌ Failed to fetch releases"
    exit 1
}

# --- find ZIP strictly by release + target ---
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

# --- unpack ---
unzip -o awg.zip >/dev/null || {
    echo "❌ ZIP extraction failed"
    exit 1
}

# --- обновляем индексы репозиториев ---
if [ "$INDEX_UPDATED" -eq 0 ]; then
    if [ "$PM" = "opkg" ]; then
        echo "[*] Updating opkg package lists..."
        opkg update || echo "⚠ Failed to update opkg lists, continuing..."
    else
        echo "[*] Updating apk package lists..."
        apk update || echo "⚠ Failed to update apk lists, continuing..."
    fi
fi

echo "[*] Installing packages via $PM"

INST_GO=0
INST_TOOLS=0
INST_LUCI=0

for pkg in \
    amneziawg-go \
    amneziawg-tools \
    luci-proto-amneziawg \
    luci-i18n-amneziawg-ru
do
    # рекурсивный поиск файла в любой подпапке awgrelease
    FILE="$(find "$TMP" -type f -path "*/awgrelease/*" \( -name "${pkg}_*" -o -name "${pkg}-*" \) | head -n1)"

    if [ -z "$FILE" ]; then
        echo "⚠ $pkg not found"
        continue
    fi

    echo "[+] Installing $FILE"

    if [ "$PM" = "opkg" ]; then
        opkg install "$FILE" || true
    else
        apk add --allow-untrusted "$FILE" || true
    fi

    case "$pkg" in
        amneziawg-go) INST_GO=1 ;;
        amneziawg-tools) INST_TOOLS=1 ;;
        luci-proto-amneziawg) INST_LUCI=1 ;;
    esac
done

echo
echo "✅ AWG-Go installation finished"

if [ "$INST_GO" -eq 1 ] &&
   [ "$INST_TOOLS" -eq 1 ] &&
   [ "$INST_LUCI" -eq 1 ]; then
    echo
    echo "⚠ Reboot required to apply changes"
    echo "⚠ Для применения изменений требуется перезагрузка роутера"
fi
