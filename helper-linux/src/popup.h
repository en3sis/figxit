#pragma once

#include "placement.h"
#include "protocol.h"

#include <QFont>
#include <QPalette>
#include <QRasterWindow>

class PopupSurface;
class QScreen;

struct Metrics {
    qreal rowHeight = 28;
    qreal inset = 5;
    qreal tile = 20;
    qreal tileRadius = 5.5;
    qreal tileX = 7;
    qreal labelOffset = 36;
    qreal rowRadius = 6;
    qreal minWidth = 260;
    qreal detailGap = 16;
    qreal corner = 9;
};

class ListWindow : public QRasterWindow
{
    Q_OBJECT

public:
    static constexpr int maxWidth = 580;

    ListWindow();

    QSize sizeFor(const QList<Item> &items) const;
    void setColors(const QPalette &colors);
    void setItems(const QList<Item> &items, int selected);
    void select(int index);
    void paint(QPainter &painter, const QSizeF &size, const QPalette &palette) const;

protected:
    void paintEvent(QPaintEvent *event) override;

private:
    QRectF rowRect(int index, qreal width) const;

    Metrics m_metrics;
    QFont m_labelFont;
    QFont m_detailFont;
    QPalette m_colors;
    QList<Item> m_items;
    int m_selected = -1;
};

class Popup
{
public:
    static constexpr int widthStep = 20;

    Popup(ListWindow *window, PopupSurface *surface);

    QRect show(const QList<Item> &items, int selected, const Placement &placement, QScreen *screen);
    void select(int index);
    void hide();

private:
    ListWindow *m_window;
    PopupSurface *m_surface;
    int m_width = 0;
};
