# This is free software, licensed under the MIT License.

include $(TOPDIR)/rules.mk

PKG_NAME:=amneziawg-go
PKG_VERSION:=2.0.9
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/amnezia-vpn/amneziawg-go.git
PKG_SOURCE_VERSION:=449d7cffd4adf86971bd679d0be5384b443e8be5
PKG_MIRROR_HASH:=a8663e9feb193b9b65e38b469d5a422ca09a3ac3de1b35a3f4a4e3a006e91237

PKG_BUILD_DEPENDS:=golang/host
PKG_BUILD_PARALLEL:=1
PKG_BUILD_FLAGS:=no-mips16

GO_PKG:=github.com/amnezia-vpn/amneziawg-go
GO_PKG_BUILD_FLAGS := -ldflags "-s -w -buildid=" CGO_ENABLED=0

include $(INCLUDE_DIR)/package.mk
include ../../packages/lang/golang/golang-package.mk

define Package/amneziawg-go
  SECTION:=net
  CATEGORY:=Network
  TITLE:=AmneziaWG userspace implementation program (written in Go)
  DEPENDS:=$(GO_ARCH_DEPENDS) +kmod-tun
endef

define Build/Compile
	$(call GoPackage/Build/Compile, -ldflags "-s -w -buildid= -X main.Build=$(PKG_VERSION)")
endef

define Package/amneziawg-go/description
	AmneziaWG is a contemporary version of the WireGuard protocol. It's a fork of
	WireGuard-Go and offers protection against detection by Deep Packet Inspection
	(DPI) systems. At the same time, it retains the simplified architecture and
	high performance of the original.
endef

define Package/amneziawg-go/install
	$(call GoPackage/Package/Install/Bin,$(PKG_INSTALL_DIR))
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/amneziawg-go $(1)/usr/bin/amneziawg-go
endef

$(eval $(call BuildPackage,amneziawg-go))
