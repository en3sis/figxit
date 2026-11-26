#pragma once

#include "../surface.h"

class QWindow;

namespace LayerShellQt
{
class Window;
}

class LayerShellSurface : public PopupSurface
{
public:
    explicit LayerShellSurface(QWindow *window);

    void place(const QRect &rect, QScreen *screen) override;

private:
    QWindow *m_window;
    LayerShellQt::Window *m_layer;
    QScreen *m_screen = nullptr;
};
