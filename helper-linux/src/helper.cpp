#include "helper.h"
#include "terminals.h"

#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QScreen>
#include <cstdio>

static bool debugging()
{
    static const bool on = qEnvironmentVariableIntValue("FIGXIT_DEBUG") > 0;
    return on;
}

static Placement fixedPlacement()
{
    QPoint at(80, 80);
    const QStringList parts = qEnvironmentVariable("FIGXIT_POPUP_AT").split(QLatin1Char(','));
    if (parts.size() == 2) at = QPoint(parts.at(0).toInt(), parts.at(1).toInt());
    Placement placement;
    placement.source = QStringLiteral("fixed");
    placement.x = at.x();
    placement.yTop = placement.yBelow = at.y() - 2;
    return placement;
}

static QScreen *screenFor(const WindowInfo &window)
{
    for (QScreen *screen : QGuiApplication::screens())
        if (screen->name() == window.output) return screen;
    return QGuiApplication::screenAt(window.client.center());
}

static qreal scaleOf(const WindowInfo &window, QScreen *screen)
{
    if (window.scale > 0) return window.scale;
    return screen ? screen->devicePixelRatio() : 1;
}

Helper::Helper(ListWindow *window, Backends backends)
    : m_surface(std::move(backends.surface))
    , m_locator(std::move(backends.locator))
    , m_focus(std::move(backends.focus))
    , m_popup(window, m_surface.get())
{
    if (m_locator) connect(m_locator.get(), &WindowLocator::changed, this, &Helper::windowChanged);
    if (m_focus) connect(m_focus.get(), &FocusTracker::focusChanged, this, &Helper::focusChanged);
}

QByteArray Helper::handle(const QByteArray &line)
{
    const std::optional<Request> request = Request::parse(line);
    if (!request) return statusReply(false, QStringLiteral("bad request"));
    const QString &cmd = request->cmd;
    if (cmd == QLatin1String("show")) {
        if (!request->grid || !request->items) return statusReply(false, QStringLiteral("show needs grid and items"));
        m_shown = Shown{m_locator ? m_locator->active() : std::nullopt, *request->grid, *request->items, request->selected, {}};
        const QString why = place();
        if (why.isEmpty()) return statusReply(true);
        forget(true);
        return statusReply(false, why);
    }
    if (cmd == QLatin1String("select")) {
        if (!m_shown) return statusReply(false, QStringLiteral("nothing shown"));
        m_shown->selected = request->selected;
        m_popup.select(request->selected);
        return statusReply(true);
    }
    if (cmd == QLatin1String("hide")) {
        forget(false);
        return statusReply(true);
    }
    if (cmd == QLatin1String("open")) return statusReply(true);
    if (cmd == QLatin1String("quit")) {
        forget(false);
        Q_EMIT quitRequested();
        return statusReply(true);
    }
    if (cmd == QLatin1String("probe")) return probe(request->grid);
    return statusReply(false, QStringLiteral("unknown cmd"));
}

Helper::Located Helper::locate(const Grid &grid, const WindowInfo &target)
{
    Located located;
    located.screen = screenFor(target);
    located.scale = scaleOf(target, located.screen);
    located.area = m_focus ? m_focus->surface(target.pid, target.client.topLeft()) : std::nullopt;
    const QRectF base = located.area.value_or(QRectF(target.client));
    located.fitted = fit(grid, base, located.area.has_value(), located.scale, terminalProfile(target.appId).devicePixels);
    return located;
}

QByteArray Helper::probe(const std::optional<Grid> &grid)
{
    QJsonObject reply{{QStringLiteral("axTrusted"), m_focus != nullptr}};
    const std::optional<WindowInfo> window = m_locator ? m_locator->active() : std::nullopt;
    if (window) {
        reply.insert(QStringLiteral("app"), window->appId);
        reply.insert(QStringLiteral("cgWindow"), rectJson(window->client));
        reply.insert(QStringLiteral("scale"), scaleOf(*window, screenFor(*window)));
        if (grid) {
            const Fit fitted = locate(*grid, *window).fitted;
            if (fitted.placement) reply.insert(QStringLiteral("placement"), placementJson(*fitted.placement));
            reply.insert(QStringLiteral("split"), fitted.split);
        }
    }
    return QJsonDocument(reply).toJson(QJsonDocument::Compact);
}

QString Helper::place()
{
    if (!m_surface) return QStringLiteral("no way to place the list on this desktop");
    if (!m_shown->window) {
        if (m_locator) return QStringLiteral("no terminal window");
        m_popup.show(m_shown->items, m_shown->selected, fixedPlacement(), nullptr);
        return {};
    }
    const WindowInfo &target = *m_shown->window;
    const Grid &grid = m_shown->grid;
    const Located located = locate(grid, target);
    const std::optional<QRectF> &area = located.area;
    const Fit &fitted = located.fitted;
    m_shown->focus = area ? m_focus->focusedId() : QString();
    if (debugging()) {
        std::fprintf(stderr, "show app=%s client=%d,%d %dx%d scale=%.3f grid=%dx%d at %d,%d cellPx=%.1fx%.1f pane=%d",
                     qPrintable(target.appId), target.client.x(), target.client.y(), target.client.width(), target.client.height(), located.scale,
                     grid.cols, grid.rows, grid.col, grid.row, grid.cellPxW.value_or(0), grid.cellPxH.value_or(0), grid.pane);
        if (area) std::fprintf(stderr, " area=%.1f,%.1f %.1fx%.1f", area->x(), area->y(), area->width(), area->height());
    }
    if (!fitted.placement) {
        if (debugging()) std::fprintf(stderr, " -> %s\n", fitted.split ? "split" : "no place");
        return fitted.split ? QStringLiteral("split pane") : QStringLiteral("no place for the list");
    }
    const QRect rect = m_popup.show(m_shown->items, m_shown->selected, *fitted.placement, located.screen);
    if (debugging()) {
        const Placement &p = *fitted.placement;
        std::fprintf(stderr, " -> cell=%.2fx%.2f x=%.1f yTop=%.1f popup=%d,%d %dx%d\n", p.cellW, p.cellH, p.x, p.yTop, rect.x(), rect.y(), rect.width(),
                     rect.height());
    }
    return {};
}

void Helper::windowChanged()
{
    if (!m_shown || !m_shown->window) return;
    const std::optional<WindowInfo> active = m_locator->active();
    if (!active || active->id != m_shown->window->id) return forget(true);
    if (*active == *m_shown->window) return;
    m_shown->window = active;
    if (!place().isEmpty()) forget(true);
}

void Helper::focusChanged()
{
    if (m_shown && !m_shown->focus.isEmpty() && m_focus->focusedId() != m_shown->focus) forget(true);
}

void Helper::forget(bool tellEngine)
{
    m_shown.reset();
    m_popup.hide();
    if (tellEngine) Q_EMIT hidden();
}
