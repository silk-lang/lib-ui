#!/usr/bin/env python3
"""Sends pointer input to the X server with XTest, one command per line on standard input:
`move X Y` (screen pixels) or `click`. It answers `ok` after the server has the events, so
the caller can time input to pixels without a new process per click (xdotool's own click
takes about 100 ms)."""
import ctypes
import sys

x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]

display = x11.XOpenDisplay(None)
if not display:
    sys.exit("xinput.py: cannot open the display")
for line in sys.stdin:
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "move":
        xtst.XTestFakeMotionEvent(display, -1, int(parts[1]), int(parts[2]), 0)
    elif parts[0] == "click":
        xtst.XTestFakeButtonEvent(display, 1, 1, 0)
        xtst.XTestFakeButtonEvent(display, 1, 0, 0)
    x11.XSync(display, 0)
    sys.stdout.write("ok\n")
    sys.stdout.flush()
