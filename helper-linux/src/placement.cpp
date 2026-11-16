#include "placement.h"

#include <algorithm>
#include <cmath>

static qreal cellPoints(std::optional<double> px, qreal scale, qreal estimate)
{
    if (!px || *px <= 0) return estimate;
    const qreal scaled = *px / scale;
    const qreal raw = *px;
    return std::abs(scaled - estimate) <= std::abs(raw - estimate) ? scaled : raw;
}

Fit fit(const Grid &grid, const QRectF &base, bool focused, qreal scale, bool physical)
{
    const bool known = grid.cellPxW && grid.cellPxH;
    if (grid.right && !known) return {};
    const qreal padX = grid.padX;
    const qreal padY = grid.padY;
    const qreal cols = std::max(grid.cols, 1);
    const qreal rows = std::max(grid.rows, 1);
    const QString source = focused ? QStringLiteral("ax") : QStringLiteral("cg");

    qreal cellW = cellPoints(grid.cellPxW, scale, (base.width() - 2 * padX) / cols);
    qreal cellH;
    qreal top;
    if (focused) {
        cellH = cellPoints(grid.cellPxH, scale, (base.height() - 2 * padY) / rows);
        top = base.top();
    } else if (grid.cellPxH) {
        cellH = cellPoints(grid.cellPxH, scale, (base.height() - 2 * padY) / rows);
        top = base.top() + std::max<qreal>(0, base.height() - rows * cellH - 2 * padY);
    } else {
        cellH = (base.height() - 2 * padY) / rows;
        top = base.top();
    }

    const auto span = [&](qreal w) { return grid.right ? std::max(cols, std::floor((base.width() - 2 * padX) / w + 0.01)) : cols; };
    const auto spareW = [&](qreal w) { return base.width() - span(w) * w - 2 * padX; };
    const auto spareH = [&](qreal h) { return base.height() - rows * h - 2 * padY; };
    const auto fills = [&](qreal w, qreal h) {
        return spareW(w) >= -0.02 * base.width() && spareW(w) <= 0.12 * base.width()
            && spareH(h) >= -0.02 * base.height() && spareH(h) <= std::max<qreal>(100, 0.2 * base.height());
    };
    const auto split = [&](qreal w, qreal h) {
        return spareW(w) >= -0.02 * base.width() && spareH(h) >= -0.02 * base.height()
            && (spareW(w) > 0.12 * base.width() || spareH(h) > std::max<qreal>(100, 0.2 * base.height()));
    };

    if (grid.pane && !focused && known) {
        const bool fits = cols * *grid.cellPxW <= base.width() * 1.02 && rows * *grid.cellPxH <= base.height() * 1.02;
        const qreal unit = physical || !fits ? scale : 1;
        cellW = *grid.cellPxW / unit;
        cellH = *grid.cellPxH / unit;
        if (!fills(cellW, cellH)) return {std::nullopt, split(cellW, cellH)};
        top = base.top() + std::max<qreal>(0, base.height() - rows * cellH - 2 * padY);
    } else if (grid.pane && !focused && (cellH < 1.6 * cellW || cellH > 3 * cellW)) {
        return {};
    } else if (!grid.pane && !focused && known && !fills(cellW, cellH)) {
        return {std::nullopt, split(cellW, cellH)};
    }
    if (grid.right) top = base.top() + std::max<qreal>(0, base.height() - rows * cellH - 2 * padY);

    Placement placement;
    placement.source = source;
    placement.surface = base;
    placement.cellW = cellW;
    placement.cellH = cellH;
    placement.x = base.left() + padX + (span(cellW) - cols + grid.col) * cellW;
    placement.yTop = top + padY + grid.row * cellH;
    placement.yBelow = placement.yTop + cellH;
    return {placement, false};
}

std::optional<QRectF> visibleSurface(const QRectF &frame, bool inScrollPane, const std::optional<QRectF> &parent)
{
    QRectF visible = frame;
    if (inScrollPane && parent) visible = frame.intersected(*parent);
    if (visible.width() > 100 && visible.height() > 100) return visible;
    return std::nullopt;
}

QRectF toGlobal(const QRectF &extents, const std::optional<QRectF> &document, const std::optional<QRectF> &host, QPointF client)
{
    if (!document || !host || host->width() <= 0 || host->height() <= 0) return extents.translated(client);
    const qreal scaleX = document->width() / host->width();
    const qreal scaleY = document->height() / host->height();
    if (scaleX <= 0 || scaleY <= 0) return extents.translated(client);
    const QPointF offset = extents.topLeft() - document->topLeft();
    return QRectF(client + QPointF(offset.x() / scaleX, offset.y() / scaleY), QSizeF(extents.width() / scaleX, extents.height() / scaleY));
}

QRect popupRect(const Placement &placement, QSize size, const QRect &bounds)
{
    qreal top = placement.yBelow + 2;
    qreal left = placement.x;
    if (!bounds.isEmpty()) {
        if (top + size.height() > bounds.y() + bounds.height()) top = placement.yTop - 2 - size.height();
        left = std::min<qreal>(left, bounds.x() + bounds.width() - size.width());
        left = std::max<qreal>(left, bounds.x());
    }
    return QRect(std::lround(left), std::lround(top), size.width(), size.height());
}
