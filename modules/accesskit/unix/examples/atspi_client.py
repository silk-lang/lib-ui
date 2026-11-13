import time, sys, pyatspi
desktop = pyatspi.Registry.getDesktop(0)
app = None
for _ in range(50):
    for i in range(desktop.childCount):
        a = desktop.getChildAtIndex(i)
        if a is not None and a.name == "Silk demo":
            app = a
    if app: break
    time.sleep(0.1)
if not app:
    print("app not found; desktop children:", [desktop.getChildAtIndex(i).name for i in range(desktop.childCount)]); sys.exit(1)
print("app:", app.name, app.getRoleName(), "toolkit:", app.get_toolkit_name(), app.get_toolkit_version(), "children:", app.childCount)
win = app.getChildAtIndex(0)
print("window:", win.name, win.getRoleName(), "states:", [str(s) for s in win.getState().getStates()], "children:", win.childCount)
for i in range(win.childCount):
    c = win.getChildAtIndex(i)
    comp = c.queryComponent()
    print("  child", i, repr(c.name), c.getRoleName(), "index", c.getIndexInParent(), "parent", c.parent.name,
          "extents", tuple(comp.getExtents(pyatspi.WINDOW_COORDS)),
          "states", [str(s).replace("STATE_","") for s in c.getState().getStates()],
          "ifaces", c.get_interfaces() if hasattr(c,'get_interfaces') else pyatspi.listInterfaces(c))
btn = win.getChildAtIndex(0)
action = btn.queryAction()
print("button actions:", action.nActions, action.getName(0))
events = []
def on(e): events.append((e.type, e.source.name if e.source else None, e.detail1, str(e.any_data)))
pyatspi.Registry.registerEventListener(on, "object:property-change:accessible-name", "object:state-changed")
ok = action.doAction(0)
print("doAction:", ok)
chk = win.getChildAtIndex(1)
chk.queryAction().doAction(0)
from gi.repository import GLib
loop = GLib.MainLoop()
GLib.timeout_add(1500, loop.quit)
loop.run()
print("events:", events)
print("button now:", repr(win.getChildAtIndex(0).name), "checkbox states:", [str(s).replace("STATE_","") for s in win.getChildAtIndex(1).getState().getStates()])
