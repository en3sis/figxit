#pragma once

#include "focus.h"
#include "locator.h"
#include "placement.h"
#include "popup.h"
#include "protocol.h"
#include "surface.h"

#include <QByteArray>
#include <QObject>
#include <QRectF>
#include <QString>
#include <memory>
#include <optional>

class QScreen;

class Helper : public QObject
{
    Q_OBJECT

public:
    struct Backends {
        std::unique_ptr<PopupSurface> surface;
        std::unique_ptr<WindowLocator> locator;
        std::unique_ptr<FocusTracker> focus;
    };

    Helper(ListWindow *window, Backends backends);

    QByteArray handle(const QByteArray &line);

Q_SIGNALS:
    void hidden();
    void quitRequested();

private:
    struct Shown {
        std::optional<WindowInfo> window;
        Grid grid;
        QList<Item> items;
        int selected = 0;
        QString focus;
    };

    struct Located {
        Fit fitted;
        std::optional<QRectF> area;
        qreal scale = 1;
        QScreen *screen = nullptr;
    };

    Located locate(const Grid &grid, const WindowInfo &target);
    QByteArray probe(const std::optional<Grid> &grid);
    QString place();
    void windowChanged();
    void focusChanged();
    void forget(bool tellEngine);

    std::unique_ptr<PopupSurface> m_surface;
    std::unique_ptr<WindowLocator> m_locator;
    std::unique_ptr<FocusTracker> m_focus;
    Popup m_popup;
    std::optional<Shown> m_shown;
};
