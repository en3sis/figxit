#pragma once

#include "protocol.h"

#include <QRect>
#include <QRectF>
#include <QSize>
#include <QString>
#include <optional>

struct Placement {
    QString source;
    QRectF surface;
    qreal cellW = 0;
    qreal cellH = 0;
    qreal x = 0;
    qreal yTop = 0;
    qreal yBelow = 0;
};

struct Fit {
    std::optional<Placement> placement;
    bool split = false;
};

Fit fit(const Grid &grid, const QRectF &base, bool focused, qreal scale, bool physical);

QRect popupRect(const Placement &placement, QSize size, const QRect &bounds);

std::optional<QRectF> visibleSurface(const QRectF &frame, bool inScrollPane, const std::optional<QRectF> &parent);

QRectF toGlobal(const QRectF &extents, const std::optional<QRectF> &document, const std::optional<QRectF> &host, QPointF client);
