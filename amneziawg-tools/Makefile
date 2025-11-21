include $(TOPDIR)/rules.mk

PKG_NAME:=amneziawg-tools
PKG_VERSION:=2.0.8
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/amnezia-vpn/amneziawg-tools.git
# Reference: v1.0.20250903
PKG_SOURCE_VERSION:=5c6ffd6168f7c69199200a91803fa02e1b8c4152
PKG_MIRROR_HASH:=6f4171c4e6a286a96060700909b7f68a3224f0f4226b308d4b17025df64bb485

PKG_LICENSE:=GPL-2.0
PKG_LICENSE_FILES:=COPYING

PKG_BUILD_DIR=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

MAKE_PATH:=src
MAKE_VARS += PLATFORM=linux

define Package/amneziawg-tools
  CATEGORY:=Network
  SUBMENU:=VPN
  URL:=https://amnezia.org/
  MAINTAINER:=Amnezia Admin <admin@amnezia.org>
  TITLE:=AmneziaWG userspace control program (awg)
  DEPENDS:= \
	  +@BUSYBOX_CONFIG_IP \
	  +@BUSYBOX_CONFIG_FEATURE_IP_LINK
endef

define Package/amneziawg-tools/description
  Amnezia VPN — simple and free app to run a self-hosted VPN with
	high privacy requirements.

  This package provides the userspace control program for AmneziaWG,
  `awg`, a netifd protocol helper, and a re-resolve watchdog script.
endef

define Package/amneziawg-tools/install
	$(INSTALL_DIR) $(1)/usr/bin/
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/src/wg $(1)/usr/bin/awg
	$(INSTALL_BIN) ./files/amneziawg_watchdog $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/lib/netifd/proto/
	$(INSTALL_BIN) ./files/amneziawg.sh $(1)/lib/netifd/proto/
endef

$(eval $(call BuildPackage,amneziawg-tools))
