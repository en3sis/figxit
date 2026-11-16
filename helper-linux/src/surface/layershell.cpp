#include "layershell.h"

#include <LayerShellQt/Window>
#include <QScreen>
#include <QWindow>

LayerShellSurface::LayerShellSurface(QWindow *window)
    : m_window(window)
    , m_layer(LayerShellQt::Window::get(window))
{
    m_layer->setLayer(LayerShellQt::Window::LayerOverlay);
    m_layer->setKeyboardInteractivity(LayerShellQt::Window::KeyboardInteractivityNone);
    m_layer->setAnchors(LayerShellQt::Window::Anchors(LayerShellQt::Window::AnchorTop | LayerShellQt::Window::AnchorLeft));
    m_layer->setExclusiveZone(-1);
    m_layer->setActivateOnShow(false);
    m_layer->setScope(QStringLiteral("figxit"));
}

void LayerShellSurface::place(const QRect &rect, QScreen *screen)
{
    if (screen != m_screen && m_window->isVisible()) m_window->hide();
    m_screen = screen;
    QPoint at = rect.topLeft();
    if (screen) {
        m_layer->setScreen(screen);
        at -= screen->geometry().topLeft();
    } else {
        m_layer->setWantsToBeOnActiveScreen(true);
    }
    m_layer->setMargins(QMargins(at.x(), at.y(), 0, 0));
    if (m_window->size() != rect.size()) m_window->resize(rect.size());
}
