
#!/bin/sh
# Copyright 2016-2017 Dan Luedtke <mail@danrl.com>
# Licensed to the public under the Apache License 2.0.

# shellcheck disable=SC1091,SC3003,SC3043

AWG=/usr/bin/awg
if [ ! -x "$AWG" ]; then
	logger -t "amneziawg" "error: missing amneziawg-tools (${AWG})"
	exit 0
fi

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

# Track host routes created for each AWG interface.
AWG_HOSTROUTE_DIR="/tmp/amneziawg-hostroutes"
AWG_HOSTROUTE_PROTO=99

proto_amneziawg_route_lock() {
	local n=0

	mkdir -p "$AWG_HOSTROUTE_DIR" || return 1

	while ! mkdir "$AWG_HOSTROUTE_DIR/.lock" 2>/dev/null; do
		n=$((n + 1))
		[ "$n" -lt 10 ] || return 1
		sleep 1
	done

	return 0
}

proto_amneziawg_route_unlock() {
	rmdir "$AWG_HOSTROUTE_DIR/.lock" 2>/dev/null
}

proto_amneziawg_route_family() {
	case "$1" in
		*:*) echo 6 ;;
		*)   echo 4 ;;
	esac
}

proto_amneziawg_route_prefix() {
	case "$(proto_amneziawg_route_family "$1")" in
		6) echo "${1}/128" ;;
		*) echo "${1}/32" ;;
	esac
}

proto_amneziawg_route_device_matches() {
	local address="$1"
	local device="$2"
	local result

	case "$address" in
		*:*) result="$(ip -6 route get "$address" 2>/dev/null)" ;;
		*)   result="$(ip -4 route get "$address" 2>/dev/null)" ;;
	esac

	case " $result " in
		*" dev $device "*) return 0 ;;
	esac

	return 1
}

proto_amneziawg_route_exists() {
	local family="$1"
	local prefix="$2"
	local device="$3"
	local route

	if [ "$family" = 6 ]; then
		route="$(ip -6 route show exact "$prefix" proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null)"
	else
		route="$(ip -4 route show exact "$prefix" proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null)"
	fi

	case " $route " in
		*" dev $device "*) return 0 ;;
	esac

	return 1
}

proto_amneziawg_add_host_route() {
	local config="$1"
	local address="$2"
	local tunlink="$3"
	local device="$4"
	local family prefix route_file owner_file owners_tmp

	[ -n "$config" ] && [ -n "$address" ] &&
		[ -n "$tunlink" ] && [ -n "$device" ] || return 1

	family="$(proto_amneziawg_route_family "$address")"
	prefix="$(proto_amneziawg_route_prefix "$address")"
	route_file="${AWG_HOSTROUTE_DIR}/${config}.routes"
	owner_file="${AWG_HOSTROUTE_DIR}/routes"

	proto_amneziawg_route_lock || return 1

	# Already registered for this interface.
	if [ -f "$route_file" ] &&
		grep -Fqx "${family}|${address}|${device}" "$route_file"; then
		proto_amneziawg_route_unlock
		return 0
	fi

	# Share a route only if our tagged route still exists.
	if [ -f "$owner_file" ] &&
		grep -Fq "${family}|${address}|${device}|" "$owner_file"; then
		if proto_amneziawg_route_exists "$family" "$prefix" "$device"; then
			printf '%s\n' "${family}|${address}|${device}" >> "$route_file" || {
				proto_amneziawg_route_unlock
				return 1
			}
			printf '%s\n' "${family}|${address}|${device}|${config}" >> "$owner_file" || {
				proto_amneziawg_route_unlock
				return 1
			}
			proto_amneziawg_route_unlock
			return 0
		fi

		# Remove stale ownership records if the managed route disappeared.
		owners_tmp="${AWG_HOSTROUTE_DIR}/routes.tmp"
		grep -Fv "${family}|${address}|${device}|" "$owner_file" > "$owners_tmp" || true
		mv "$owners_tmp" "$owner_file"
	fi

	# Leave an existing route untouched if it already uses the requested device.
	if proto_amneziawg_route_device_matches "$address" "$device"; then
		proto_amneziawg_route_unlock
		return 0
	fi

	# Never replace any existing route to this endpoint.
	if [ "$family" = 6 ]; then
		route="$(ip -6 route show exact "$prefix" 2>/dev/null)"
	else
		route="$(ip -4 route show exact "$prefix" 2>/dev/null)"
	fi

	if [ -n "$route" ]; then
		proto_amneziawg_route_unlock
		logger -t amneziawg \
			"warning: route to ${address} already exists; not replacing it"
		return 1
	fi

	# Tag the route so cleanup can identify routes managed by this helper.
	if [ "$family" = 6 ]; then
		ip -6 route add "$prefix" dev "$device" proto "$AWG_HOSTROUTE_PROTO" || {
			proto_amneziawg_route_unlock
			return 1
		}
	else
		ip -4 route add "$prefix" dev "$device" proto "$AWG_HOSTROUTE_PROTO" || {
			proto_amneziawg_route_unlock
			return 1
		}
	fi

	if ! printf '%s\n' "${family}|${address}|${device}" >> "$route_file" ||
		! printf '%s\n' "${family}|${address}|${device}|${config}" >> "$owner_file"; then
		# Remove only the route tagged by this helper.
		if [ "$family" = 6 ]; then
			ip -6 route del "$prefix" dev "$device" \
				proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null || true
		else
			ip -4 route del "$prefix" dev "$device" \
				proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null || true
		fi
		proto_amneziawg_route_unlock
		return 1
	fi

	proto_amneziawg_route_unlock
	return 0
}

proto_amneziawg_remove_host_routes() {
	local config="$1"
	local route_file="${AWG_HOSTROUTE_DIR}/${config}.routes"
	local owner_file="${AWG_HOSTROUTE_DIR}/routes"
	local owners_tmp
	local family address device prefix

	[ -f "$route_file" ] || return 0
	proto_amneziawg_route_lock || return 1

	owners_tmp="${AWG_HOSTROUTE_DIR}/routes.tmp"
	touch "$owner_file" || {
		proto_amneziawg_route_unlock
		return 1
	}

	while IFS='|' read -r family address device; do
		[ -n "$address" ] || continue

		# Remove only this interface's ownership record.
		grep -Fvx "${family}|${address}|${device}|${config}" \
			"$owner_file" > "$owners_tmp" || true
		mv "$owners_tmp" "$owner_file" || {
			proto_amneziawg_route_unlock
			return 1
		}

		# Keep the route if another AWG interface still owns it.
		if grep -Fq "${family}|${address}|${device}|" "$owner_file"; then
			continue
		fi

		prefix="$(proto_amneziawg_route_prefix "$address")"

		# Delete only a tagged route that still uses the expected device.
		if proto_amneziawg_route_exists "$family" "$prefix" "$device"; then
			if [ "$family" = 6 ]; then
				ip -6 route del "$prefix" dev "$device" \
					proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null || true
			else
				ip -4 route del "$prefix" dev "$device" \
					proto "$AWG_HOSTROUTE_PROTO" 2>/dev/null || true
			fi
		fi
	done < "$route_file"

	rm -f "$route_file" "$owners_tmp"
	proto_amneziawg_route_unlock
	return 0
}

# AmneziaWG obfuscation parameters, in '<uci option>:<configuration file key>'
AWG_PARAMS="
awg_jc:Jc
awg_jmin:Jmin
awg_jmax:Jmax
awg_s1:S1
awg_s2:S2
awg_s3:S3
awg_s4:S4
awg_h1:H1
awg_h2:H2
awg_h3:H3
awg_h4:H4
awg_i1:I1
awg_i2:I2
awg_i3:I3
awg_i4:I4
awg_i5:I5
awg_header_protection_key:HeaderProtectionKey
awg_content_padding_addition:ContentPaddingAddition
awg_rekey_after_time:RekeyAfterTime
awg_rekey_timeout:RekeyTimeout
awg_reject_after_time:RejectAfterTime
awg_keepalive_timeout:KeepaliveTimeout
awg_max_handshake_attempts:MaxHandshakeAttempts
"

AWG_BOOL_PARAMS="
awg_random_trailers:RandomTrailers
awg_disable_cookies:DisableCookies
"

proto_amneziawg_init_config() {
	proto_config_add_string "private_key"
	proto_config_add_int "listen_port"
	proto_config_add_int "mtu"
	proto_config_add_string "fwmark"
	proto_config_add_int "awg_jc"
	proto_config_add_int "awg_jmin"
	proto_config_add_int "awg_jmax"
	proto_config_add_int "awg_s1"
	proto_config_add_int "awg_s2"
	proto_config_add_int "awg_s3"
	proto_config_add_int "awg_s4"
	proto_config_add_string "awg_h1"
	proto_config_add_string "awg_h2"
	proto_config_add_string "awg_h3"
	proto_config_add_string "awg_h4"
	proto_config_add_string "awg_i1"
	proto_config_add_string "awg_i2"
	proto_config_add_string "awg_i3"
	proto_config_add_string "awg_i4"
	proto_config_add_string "awg_i5"
	proto_config_add_string "awg_header_protection_key"
	proto_config_add_string "awg_content_padding_addition"
	proto_config_add_string "awg_rekey_after_time"
	proto_config_add_string "awg_rekey_timeout"
	proto_config_add_string "awg_reject_after_time"
	proto_config_add_string "awg_keepalive_timeout"
	proto_config_add_string "awg_max_handshake_attempts"
	proto_config_add_boolean "awg_random_trailers"
	proto_config_add_boolean "awg_disable_cookies"
# shellcheck disable=SC2034
	available=1
# shellcheck disable=SC2034
	no_proto_task=1
}

proto_amneziawg_is_kernel_mode() {
	if [ ! -e /sys/module/amneziawg ]; then
		modprobe amneziawg >/dev/null 2>&1 || true

		if [ -e /sys/module/amneziawg ]; then
			return 0
		fi

		if ! command -v "${AWG_QUICK_USERSPACE_IMPLEMENTATION:-amneziawg-go}" >/dev/null 2>&1; then
			echo "Please install either kernel module (kmod-amneziawg package) or user-space implementation in /usr/bin/amneziawg-go."
			return 2
		fi

		return 1
	fi

	return 0
}

proto_amneziawg_setup_peer() {
	local peer_config="$1"
	local disabled public_key preshared_key allowed_ips route_allowed_ips
	local endpoint_host endpoint_port persistent_keepalive endpoint allowed_ip

	config_get_bool disabled "${peer_config}" "disabled" 0
	config_get public_key "${peer_config}" "public_key"
	config_get preshared_key "${peer_config}" "preshared_key"
	config_get allowed_ips "${peer_config}" "allowed_ips"
	config_get_bool route_allowed_ips "${peer_config}" "route_allowed_ips" 0
	config_get endpoint_host "${peer_config}" "endpoint_host"
	config_get endpoint_port "${peer_config}" "endpoint_port"
	config_get persistent_keepalive "${peer_config}" "persistent_keepalive"

	[ "${disabled}" -eq 1 ] && return 0

	if [ -z "$public_key" ]; then
		echo "Skipping peer config $peer_config because public key is not defined."
		return 0
	fi

	echo "[Peer]" >> "${awg_cfg}"
	echo "PublicKey=${public_key}" >> "${awg_cfg}"
	[ -n "$preshared_key" ] && echo "PresharedKey=${preshared_key}" >> "${awg_cfg}"

	for allowed_ip in ${allowed_ips}; do
		echo "AllowedIPs=${allowed_ip}" >> "${awg_cfg}"
	done

	if [ -n "$endpoint_host" ]; then
		case "$endpoint_host" in
			*:*) endpoint="[${endpoint_host}]" ;;
			*)   endpoint="${endpoint_host}" ;;
		esac

		endpoint="${endpoint}:${endpoint_port:-51820}"
		echo "Endpoint=${endpoint}" >> "${awg_cfg}"
	fi

	[ -n "$persistent_keepalive" ] &&
		echo "PersistentKeepalive=${persistent_keepalive}" >> "${awg_cfg}"

	if [ "$route_allowed_ips" -ne 0 ]; then
		for allowed_ip in ${allowed_ips}; do
			case "$allowed_ip" in
				*:*/*) proto_add_ipv6_route "${allowed_ip%%/*}" "${allowed_ip##*/}" ;;
				*.*/*) proto_add_ipv4_route "${allowed_ip%%/*}" "${allowed_ip##*/}" ;;
				*:* )  proto_add_ipv6_route "${allowed_ip%%/*}" "128" ;;
				*.* )  proto_add_ipv4_route "${allowed_ip%%/*}" "32" ;;
			esac
		done
	fi
}

proto_amneziawg_write_params() {
	local config="$1"
	local param option value

	for param in ${AWG_PARAMS}; do
		option="${param%%:*}"
		config_get value "${config}" "${option}"
		[ -n "${value}" ] && echo "${param##*:}=${value}" >> "${awg_cfg}"
	done

	for param in ${AWG_BOOL_PARAMS}; do
		option="${param%%:*}"
		config_get_bool value "${config}" "${option}" 0
		[ "$value" = "1" ] && echo "${param##*:}=on" >> "${awg_cfg}"
	done

	return 0
}

ensure_key_is_generated() {
	local private_key

	private_key="$(uci -q get network."$1".private_key)"

	if [ "$private_key" = "generate" ]; then
		local ucitmp oldmask
		oldmask="$(umask)"
		umask 077
		ucitmp="$(mktemp -d)" || {
			umask "$oldmask"
			return 1
		}
		private_key="$("${AWG}" genkey)" || {
			rm -rf "$ucitmp"
			umask "$oldmask"
			return 1
		}
		uci -q -t "$ucitmp" set network."$1".private_key="$private_key" &&
			uci -q -t "$ucitmp" commit network
		local ret=$?
		rm -rf "$ucitmp"
		umask "$oldmask"
		return "$ret"
	fi

	return 0
}

proto_amneziawg_setup() {
	local config="$1"
	local awg_dir="/tmp/amneziawg"
	local awg_cfg="${awg_dir}/${config}"
	local private_key listen_port addresses mtu fwmark ip6prefix
	local nohostroute tunlink tunlink_device address prefix
	local mode_status endpoints_file key endpoint
	local route_error=0

	ensure_key_is_generated "${config}" || {
		proto_setup_failed "$config"
		return 1
	}

	config_load network
	config_get private_key "${config}" "private_key"
	config_get listen_port "${config}" "listen_port"
	config_get addresses "${config}" "addresses"
	config_get mtu "${config}" "mtu"
	config_get fwmark "${config}" "fwmark"
	config_get ip6prefix "${config}" "ip6prefix"
	config_get_bool nohostroute "${config}" "nohostroute" 0
	config_get tunlink "${config}" "tunlink"

	# Clear stale registrations before rebuilding routes.
	proto_amneziawg_remove_host_routes "${config}" || {
		proto_setup_failed "$config"
		return 1
	}

	tunlink_device=""
	if [ -n "$tunlink" ]; then
		network_get_device tunlink_device "$tunlink" || tunlink_device=""
	fi

	proto_amneziawg_is_kernel_mode
	mode_status=$?

	case "$mode_status" in
		0)
			logger -t amneziawg "info: using kernel-space kmod-amneziawg for ${config}"
			ip link del dev "$config" 2>/dev/null
			ip link add dev "$config" type amneziawg || {
				proto_setup_failed "$config"
				return 1
			}
			;;
		1)
			logger -t amneziawg "info: using user-space amneziawg-go for ${config}"
			rm -f "/var/run/amneziawg/${config}.sock"
			amneziawg-go "$config" || {
				proto_setup_failed "$config"
				return 1
			}
			;;
		*)
			proto_setup_failed "$config"
			return 1
			;;
	esac

	[ -n "$mtu" ] && ip link set mtu "$mtu" dev "$config"

	proto_init_update "$config" 1

	umask 077
	mkdir -p "$awg_dir" || {
		proto_setup_failed "$config"
		return 1
	}

	echo "[Interface]" > "$awg_cfg"
	echo "PrivateKey=${private_key}" >> "$awg_cfg"
	[ -n "$listen_port" ] && echo "ListenPort=${listen_port}" >> "$awg_cfg"
	[ -n "$fwmark" ] && echo "FwMark=${fwmark}" >> "$awg_cfg"

	proto_amneziawg_write_params "$config"
	config_foreach proto_amneziawg_setup_peer "amneziawg_${config}"

	"$AWG" setconf "$config" "$awg_cfg"
	mode_status=$?
	rm -f "$awg_cfg"

	if [ "$mode_status" -ne 0 ]; then
		sleep 1
		proto_setup_failed "$config"
		return 1
	fi

	for address in ${addresses}; do
		case "$address" in
			*:*/*) proto_add_ipv6_address "${address%%/*}" "${address##*/}" ;;
			*.*/*) proto_add_ipv4_address "${address%%/*}" "${address##*/}" ;;
			*:* )  proto_add_ipv6_address "${address%%/*}" "128" ;;
			*.* )  proto_add_ipv4_address "${address%%/*}" "32" ;;
		esac
	done

	for prefix in ${ip6prefix}; do
		proto_add_ipv6_prefix "$prefix"
	done

	# Explicit endpoint host routes through tunlink.
	if [ "$nohostroute" != "1" ]; then
		endpoints_file="$(mktemp /tmp/amneziawg-endpoints.XXXXXX)" || {
			proto_setup_failed "$config"
			return 1
		}

		if ! "$AWG" show "$config" endpoints > "$endpoints_file"; then
			rm -f "$endpoints_file"
			proto_setup_failed "$config"
			return 1
		fi

		while read -r key endpoint; do
			[ -n "$endpoint" ] || continue
			case "$endpoint" in
				"(none)") continue ;;
				\[*\]:*)
					address="${endpoint#\[}"
					address="${address%%\]*}"
					;;
				*:*)
					address="${endpoint%:*}"
					;;
				*)
					address="$endpoint"
					;;
			esac

			[ -n "$address" ] || continue

			if [ -n "$tunlink" ] && [ -n "$tunlink_device" ]; then
				proto_amneziawg_add_host_route \
					"$config" "$address" "$tunlink" "$tunlink_device" || {
					route_error=1
					break
				}
			else
				proto_add_host_dependency "$config" "$address" "$tunlink"
			fi
		done < "$endpoints_file"

		rm -f "$endpoints_file"

		if [ "$route_error" -ne 0 ]; then
			proto_amneziawg_remove_host_routes "$config"
			proto_setup_failed "$config"
			return 1
		fi
	fi

	proto_send_update "$config"
}

proto_amneziawg_teardown() {
	local config="$1"

	proto_amneziawg_remove_host_routes "$config" || true

	if proto_amneziawg_is_kernel_mode; then
		ip link del dev "$config" >/dev/null 2>&1
	else
		rm -f "/var/run/amneziawg/${config}.sock"
	fi
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol amneziawg
}
