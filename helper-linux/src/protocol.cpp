#include "protocol.h"
#include "placement.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QRectF>

static std::optional<double> number(const QJsonObject &object, const char *key)
{
    const QJsonValue value = object.value(QLatin1String(key));
    return value.isDouble() ? std::optional(value.toDouble()) : std::nullopt;
}

static Grid gridFrom(const QJsonObject &object)
{
    Grid grid;
    grid.cols = object.value(QLatin1String("cols")).toInt();
    grid.rows = object.value(QLatin1String("rows")).toInt();
    grid.col = object.value(QLatin1String("col")).toInt();
    grid.row = object.value(QLatin1String("row")).toInt();
    grid.cellPxW = number(object, "cellPxW");
    grid.cellPxH = number(object, "cellPxH");
    grid.padX = object.value(QLatin1String("padX")).toDouble();
    grid.padY = object.value(QLatin1String("padY")).toDouble();
    grid.pane = object.value(QLatin1String("pane")).toBool();
    grid.right = object.value(QLatin1String("right")).toBool();
    return grid;
}

static QList<Item> itemsFrom(const QJsonArray &array)
{
    QList<Item> items;
    items.reserve(array.size());
    for (const QJsonValue &value : array) {
        const QJsonObject object = value.toObject();
        items.append({
            object.value(QLatin1String("label")).toString(),
            object.value(QLatin1String("detail")).toString(),
            object.value(QLatin1String("icon")).toString(),
            object.value(QLatin1String("tint")).toString(),
        });
    }
    return items;
}

std::optional<Request> Request::parse(const QByteArray &line)
{
    QJsonParseError error;
    const QJsonDocument document = QJsonDocument::fromJson(line, &error);
    if (error.error != QJsonParseError::NoError || !document.isObject()) return std::nullopt;
    const QJsonObject object = document.object();
    const QJsonValue cmd = object.value(QLatin1String("cmd"));
    if (!cmd.isString()) return std::nullopt;

    Request request;
    request.cmd = cmd.toString();
    if (object.value(QLatin1String("grid")).isObject()) request.grid = gridFrom(object.value(QLatin1String("grid")).toObject());
    if (object.value(QLatin1String("items")).isArray()) request.items = itemsFrom(object.value(QLatin1String("items")).toArray());
    request.selected = object.value(QLatin1String("selected")).toInt(0);
    request.caret = object.value(QLatin1String("caret")).toInt(0);
    return request;
}

QList<Item> parseItems(const QByteArray &json)
{
    return itemsFrom(QJsonDocument::fromJson(json).array());
}

QByteArray statusReply(bool ok, const QString &error)
{
    QJsonObject reply{{QStringLiteral("ok"), ok}};
    if (!error.isEmpty()) reply.insert(QStringLiteral("error"), error);
    return QJsonDocument(reply).toJson(QJsonDocument::Compact);
}

QJsonObject rectJson(const QRectF &rect)
{
    return {{QStringLiteral("x"), rect.x()}, {QStringLiteral("y"), rect.y()}, {QStringLiteral("w"), rect.width()}, {QStringLiteral("h"), rect.height()}};
}

QJsonObject placementJson(const Placement &placement)
{
    return {
        {QStringLiteral("source"), placement.source},
        {QStringLiteral("surface"), rectJson(placement.surface)},
        {QStringLiteral("cellW"), placement.cellW},
        {QStringLiteral("cellH"), placement.cellH},
        {QStringLiteral("x"), placement.x},
        {QStringLiteral("yTop"), placement.yTop},
        {QStringLiteral("yBelow"), placement.yBelow},
    };
}
