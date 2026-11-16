const service = "FIGXIT_SERVICE";
let watched = null;

function send() {
    const window = watched;
    if (!window) {
        callDBus(service, "/Locator", "org.figxit.Locator", "noWindow");
        return;
    }
    const g = window.clientGeometry;
    const output = window.output;
    callDBus(service, "/Locator", "org.figxit.Locator", "window", JSON.stringify({
        id: window.internalId.toString(),
        pid: window.pid,
        appId: window.resourceClass || "",
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        output: output ? output.name : "",
        scale: output ? (output.devicePixelRatio || output.scale || 0) : 0,
    }));
}

function watch(window) {
    if (watched) watched.frameGeometryChanged.disconnect(send);
    watched = window;
    if (watched) watched.frameGeometryChanged.connect(send);
    send();
}

workspace.windowActivated.connect(watch);
watch(workspace.activeWindow);
