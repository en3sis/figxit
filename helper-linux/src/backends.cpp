#include "backends.h"
#include "accessibility.h"
#include "locator.h"
#include "locator/kwin.h"
#include "surface.h"
#include "surface/layershell.h"

#include <QGuiApplication>
#include <cstdio>

namespace
{

template<typename Locator>
std::unique_ptr<WindowLocator> make(const QString &name)
{
    return std::make_unique<Locator>(name);
}

struct LocatorBackend {
    const char *name;
    bool (*available)();
    std::unique_ptr<WindowLocator> (*make)(const QString &name);
};

const LocatorBackend locators[] = {
    {"kwin", &KWinLocator::available, &make<KWinLocator>},
};

}

std::unique_ptr<WindowLocator> startLocator(const QString &name)
{
    const QString wanted = qEnvironmentVariable("FIGXIT_WINDOW_BACKEND");
    if (wanted == QLatin1String("none")) return nullptr;
    bool known = wanted.isEmpty();
    for (const LocatorBackend &backend : locators) {
        if (wanted.isEmpty() ? !backend.available() : wanted != QLatin1String(backend.name)) continue;
        known = true;
        std::unique_ptr<WindowLocator> locator = backend.make(name);
        if (locator->start()) return locator;
        std::fprintf(stderr, "figxit-helper: the %s window backend did not start\n", backend.name);
    }
    if (!known) std::fprintf(stderr, "figxit-helper: no window backend is called %s\n", qPrintable(wanted));
    return nullptr;
}

std::unique_ptr<PopupSurface> makeSurface(QWindow *window)
{
    const QString platform = QGuiApplication::platformName();
    if (platform.startsWith(QLatin1String("wayland"))) return std::make_unique<LayerShellSurface>(window);
    std::fprintf(stderr, "figxit-helper: no way to place the list on %s\n", qPrintable(platform));
    return nullptr;
}

std::unique_ptr<FocusTracker> startFocus()
{
    auto focus = std::make_unique<AccessibleFocus>();
    if (!focus->start()) return nullptr;
    return focus;
}
