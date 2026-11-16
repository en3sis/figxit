#include "popup.h"
#include "surface.h"
#include "theme.h"

#include <QFontDatabase>
#include <QFontMetricsF>
#include <QGuiApplication>
#include <QPainter>
#include <QScreen>
#include <QSurfaceFormat>
#include <algorithm>
#include <cmath>

static QColor tintColor(const QString &hex)
{
    bool ok = false;
    const uint value = hex.size() == 6 ? hex.toUInt(&ok, 16) : 0;
    return ok ? QColor((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF) : QColor(0x8E, 0x8E, 0x93);
}

ListWindow::ListWindow()
{
    QSurfaceFormat format = this->format();
    format.setAlphaBufferSize(8);
    setFormat(format);
    setFlags(Qt::FramelessWindowHint | Qt::WindowDoesNotAcceptFocus | Qt::WindowTransparentForInput);

    m_labelFont = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    m_labelFont.setPixelSize(13);
    m_labelFont.setWeight(QFont::Medium);
    m_detailFont = QGuiApplication::font();
    m_detailFont.setPixelSize(12);
}

QSize ListWindow::sizeFor(const QList<Item> &items) const
{
    const QFontMetricsF label(m_labelFont);
    const QFontMetricsF detail(m_detailFont);
    qreal widest = 0;
    for (const Item &item : items) {
        const qreal detailWidth = item.detail.isEmpty() ? 0 : detail.horizontalAdvance(item.detail) + m_metrics.detailGap + 8;
        widest = std::max(widest, label.horizontalAdvance(item.label) + detailWidth);
    }
    const qreal width = std::min(std::max(widest + 2 * m_metrics.inset + m_metrics.labelOffset + 14, m_metrics.minWidth), qreal(maxWidth));
    return QSize(std::ceil(width), std::ceil(items.size() * m_metrics.rowHeight + 2 * m_metrics.inset));
}

void ListWindow::setColors(const QPalette &colors)
{
    m_colors = colors;
    update();
}

void ListWindow::setItems(const QList<Item> &items, int selected)
{
    m_items = items;
    m_selected = selected;
    update();
}

void ListWindow::select(int index)
{
    if (index == m_selected) return;
    m_selected = index;
    update();
}

QRectF ListWindow::rowRect(int index, qreal width) const
{
    return QRectF(m_metrics.inset, m_metrics.inset + index * m_metrics.rowHeight, width - 2 * m_metrics.inset, m_metrics.rowHeight);
}

void ListWindow::paintEvent(QPaintEvent *)
{
    QPainter painter(this);
    painter.setCompositionMode(QPainter::CompositionMode_Source);
    painter.fillRect(QRect(QPoint(), size()), Qt::transparent);
    painter.setCompositionMode(QPainter::CompositionMode_SourceOver);
    paint(painter, size(), m_colors);
}

void ListWindow::paint(QPainter &painter, const QSizeF &size, const QPalette &palette) const
{
    painter.setRenderHint(QPainter::Antialiasing);
    const Metrics &m = m_metrics;

    QColor background = palette.color(QPalette::Window);
    background.setAlphaF(0.97);
    QColor border = palette.color(QPalette::WindowText);
    border.setAlphaF(0.18);
    painter.setPen(QPen(border, 1));
    painter.setBrush(background);
    painter.drawRoundedRect(QRectF(0.5, 0.5, size.width() - 1, size.height() - 1), m.corner, m.corner);

    const QFontMetricsF labelMetrics(m_labelFont);
    const QFontMetricsF detailMetrics(m_detailFont);
    for (int index = 0; index < m_items.size(); ++index) {
        const Item &item = m_items.at(index);
        const QRectF row = rowRect(index, size.width());
        const bool active = index == m_selected;
        if (active) {
            painter.setPen(Qt::NoPen);
            painter.setBrush(palette.color(QPalette::Highlight));
            painter.drawRoundedRect(row, m.rowRadius, m.rowRadius);
        }

        if (!item.icon.isEmpty()) {
            const QRectF tile(row.left() + m.tileX, row.center().y() - m.tile / 2, m.tile, m.tile);
            painter.setPen(QPen(QColor(255, 255, 255, 46), 0.5));
            painter.setBrush(tintColor(item.tint));
            painter.drawRoundedRect(tile, m.tileRadius, m.tileRadius);
        }

        const QColor labelColor = palette.color(active ? QPalette::HighlightedText : QPalette::WindowText);
        QColor detailColor = labelColor;
        detailColor.setAlphaF(active ? 0.8 : 0.55);

        const qreal labelX = row.left() + m.labelOffset;
        const QString label = labelMetrics.elidedText(item.label, Qt::ElideRight, row.right() - 10 - labelX);
        const qreal labelWidth = labelMetrics.horizontalAdvance(label);
        painter.setFont(m_labelFont);
        painter.setPen(labelColor);
        painter.drawText(QRectF(labelX, row.top(), labelWidth + 1, row.height()), Qt::AlignVCenter | Qt::AlignLeft, label);

        if (item.detail.isEmpty()) continue;
        const qreal fullWidth = detailMetrics.horizontalAdvance(item.detail);
        const qreal x = std::max(labelX + labelWidth + m.detailGap, row.right() - 10 - fullWidth);
        const QString detail = detailMetrics.elidedText(item.detail, Qt::ElideRight, row.right() - 10 - x);
        if (detail.isEmpty()) continue;
        painter.setFont(m_detailFont);
        painter.setPen(detailColor);
        painter.drawText(QRectF(x, row.top(), detailMetrics.horizontalAdvance(detail) + 1, row.height()), Qt::AlignVCenter | Qt::AlignLeft, detail);
    }
}

Popup::Popup(ListWindow *window, PopupSurface *surface)
    : m_window(window)
    , m_surface(surface)
{
}

QRect Popup::show(const QList<Item> &items, int selected, const Placement &placement, QScreen *screen)
{
    if (items.isEmpty()) {
        hide();
        return {};
    }
    const bool opening = !m_window->isVisible();
    const QSize needed = m_window->sizeFor(items);
    const int stepped = int(std::ceil(needed.width() / double(widthStep))) * widthStep;
    m_width = std::min(std::max(opening ? 0 : m_width, stepped), int(ListWindow::maxWidth));
    if (opening) m_window->setColors(desktopPalette());
    m_window->setItems(items, selected < 0 ? -1 : std::min(selected, int(items.size()) - 1));
    const QRect rect = popupRect(placement, QSize(m_width, needed.height()), screen ? screen->geometry() : QRect());
    m_surface->place(rect, screen);
    if (!m_window->isVisible()) m_window->show();
    return rect;
}

void Popup::select(int index)
{
    m_window->select(index);
}

void Popup::hide()
{
    m_window->hide();
}
