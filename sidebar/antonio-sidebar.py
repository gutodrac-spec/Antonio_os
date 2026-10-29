#!/usr/bin/env python3
"""Antonio OS sidebar: a layer-shell panel docked to the right edge that hosts the chat UI.

The panel reserves its own screen space (like a dock), so it never covers the user's
windows. SIGUSR1 toggles it; it talks only to the local antonio-agentd service.
"""
import os
import signal
import sys
import time
import urllib.request

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("GtkLayerShell", "0.1")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, GtkLayerShell, WebKit2  # noqa: E402

STATE_DIR = os.environ.get(
    "ANTONIO_STATE_DIR",
    os.path.join(os.environ.get("XDG_STATE_HOME", os.path.expanduser("~/.local/state")), "antonio"),
)
BASE_URL = os.environ.get("ANTONIO_URL", "http://127.0.0.1:%s" % os.environ.get("ANTONIO_PORT", "7777"))
WIDTH = int(os.environ.get("ANTONIO_SIDEBAR_WIDTH", "420"))


# The daemon is local: never route its traffic through an HTTP proxy.
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def read_token(timeout=30.0):
    """Waits for the agent daemon to come up and returns its access token."""
    path = os.path.join(STATE_DIR, "token")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with LOCAL.open(BASE_URL + "/index.html", timeout=1):
                pass
            with open(path) as f:
                return f.read().strip()
        except OSError:
            time.sleep(0.5)
    return ""


class Sidebar(Gtk.Window):
    def __init__(self, token):
        super().__init__(title="Antonio")
        Gtk.Settings.get_default().set_property("gtk-application-prefer-dark-theme", True)
        self.set_default_size(WIDTH, -1)
        if GtkLayerShell.is_supported():
            GtkLayerShell.init_for_window(self)
            GtkLayerShell.set_namespace(self, "antonio-sidebar")
            GtkLayerShell.set_layer(self, GtkLayerShell.Layer.TOP)
            for edge in (GtkLayerShell.Edge.TOP, GtkLayerShell.Edge.BOTTOM, GtkLayerShell.Edge.RIGHT):
                GtkLayerShell.set_anchor(self, edge, True)
            GtkLayerShell.auto_exclusive_zone_enable(self)
            GtkLayerShell.set_keyboard_mode(self, GtkLayerShell.KeyboardMode.ON_DEMAND)
        else:
            print("antonio-sidebar: compositor sem wlr-layer-shell; abrindo como janela comum", file=sys.stderr)

        WebKit2.WebContext.get_default().set_network_proxy_settings(WebKit2.NetworkProxyMode.NO_PROXY, None)
        settings = WebKit2.Settings()
        settings.set_enable_developer_extras(os.environ.get("ANTONIO_DEVTOOLS") == "1")
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
        self.view = WebKit2.WebView.new_with_settings(settings)
        # A layer surface takes its width from the content; a WebView has no natural size.
        self.view.set_size_request(WIDTH, -1)
        self.view.connect("decide-policy", self.on_policy)
        self.view.load_uri("%s/?token=%s" % (BASE_URL, token))
        self.add(self.view)
        self.connect("destroy", Gtk.main_quit)

    def on_policy(self, view, decision, kind):
        # External links open in the user's browser, never inside the sidebar.
        if kind == WebKit2.PolicyDecisionType.NEW_WINDOW_ACTION or kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(BASE_URL):
                decision.ignore()
                Gtk.show_uri_on_window(self, uri, Gtk.get_current_event_time())
                return True
        return False

    def toggle(self):
        if self.get_visible():
            self.hide()
        else:
            self.show_all()
            self.present()
        return GLib.SOURCE_REMOVE


def main():
    token = read_token()
    if not token:
        print("antonio-sidebar: antonio-agentd não respondeu", file=sys.stderr)
    win = Sidebar(token)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, win.toggle)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, Gtk.main_quit)
    win.show_all()
    Gtk.main()


if __name__ == "__main__":
    main()
