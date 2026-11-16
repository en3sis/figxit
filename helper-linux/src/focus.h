#pragma once

#include <QObject>
#include <QPoint>
#include <QRectF>
#include <QString>
#include <optional>

class FocusTracker : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual std::optional<QRectF> surface(qint64 pid, QPoint client) = 0;

    virtual QString focusedId() const = 0;

Q_SIGNALS:
    void focusChanged();
};
