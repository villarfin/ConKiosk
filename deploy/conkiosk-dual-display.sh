#!/bin/sh
# Starts one local ConKiosk browser per physical display after the Labwc desktop
# session is ready. HDMI-A-1 is the touchscreen kiosk; HDMI-A-2 is the TV board.

set -eu

KIOSK_URL="http://127.0.0.1/kiosk"
TV_URL="http://127.0.0.1/tv"
KIOSK_PROFILE="$HOME/.local/share/conkiosk-kiosk-browser"
TV_PROFILE="$HOME/.local/share/conkiosk-tv-browser"
# Required for Chromium on Wayland to request Squeekboard for focused text
# inputs. Without this, the on-screen keyboard can disappear in --kiosk mode.
# ConKiosk screens do not store user credentials. Avoid GNOME Keyring so a
# kiosk boot never opens an "Unlock Keyring" dialog.
CHROMIUM_WAYLAND_FLAGS="--ozone-platform=wayland --enable-features=UseOzonePlatform,VirtualKeyboard --enable-wayland-ime --wayland-text-input-version=3 --password-store=basic"

mkdir -p "$KIOSK_PROFILE" "$TV_PROFILE"

output_enabled() {
  wlr-randr | awk -v output="$1" '
    $1 == output { checking = 1; next }
    checking && $1 == "Enabled:" && $2 == "yes" { enabled = 1; exit }
    checking && /^[^[:space:]]/ { exit }
    END { exit(enabled ? 0 : 1) }
  '
}

# Chromium on this Labwc build opens new fullscreen windows on the output that
# contains the focused pointer. Move the virtual pointer to the far edge of
# the extended desktop before each launch: left is HDMI1, right is HDMI2.
# This is more reliable here than Chromium's X11-only --class placement.
focus_hdmi1() {
  command -v wlrctl >/dev/null 2>&1 && wlrctl pointer move -10000 0 >/dev/null 2>&1 || true
}

focus_hdmi2() {
  command -v wlrctl >/dev/null 2>&1 && wlrctl pointer move 10000 0 >/dev/null 2>&1 || true
}

# Do not start a browser before the local server and kiosk display are ready.
# The kiosk must still work if the TV has not been powered on or detected yet.
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1/api/health >/dev/null 2>&1 \
    && output_enabled HDMI-A-1; then
    ready=1
    break
  fi
  sleep 2
done
[ "$ready" -eq 1 ] || exit 0

# Separate browser profiles allow two independent Chromium kiosk windows.
# Labwc rules (conkiosk-labwc-rc.xml) place these classes on their HDMI outputs.
# This script is run only by Labwc's single autostart entry. Do not use pgrep
# here: it can match the launcher itself and prevent either window from opening.
focus_hdmi1
chromium $CHROMIUM_WAYLAND_FLAGS \
  --class=conkiosk-kiosk --start-fullscreen --no-first-run --disable-session-crashed-bubble \
  --disable-infobars --user-data-dir="$KIOSK_PROFILE" "$KIOSK_URL" >/dev/null 2>&1 &

# Chromium maps its Wayland window asynchronously. Keep the pointer on HDMI1
# until that kiosk window has been created; otherwise it follows the later
# HDMI2 focus and both screens can land on the TV output.
sleep 5

# HDMI2 is optional at boot. Give a connected TV time to wake, but never hold
# the kiosk hostage while doing so.
for _ in $(seq 1 30); do
  if output_enabled HDMI-A-2; then
    focus_hdmi2
    chromium $CHROMIUM_WAYLAND_FLAGS \
      --class=conkiosk-tv --kiosk --autoplay-policy=no-user-gesture-required --no-first-run --disable-session-crashed-bubble \
      --disable-infobars --user-data-dir="$TV_PROFILE" "$TV_URL" >/dev/null 2>&1 &
    break
  fi
  sleep 2
done
