#pragma once

#include <QObject>
#include <QRect>
#include <QString>
#include <optional>

struct WindowInfo {
    QString id;
    qint64 pid = 0;
    QString appId;
    QRect client;
    QString output;
    qreal scale = 0;

    bool operator==(const WindowInfo &) const = default;
};

class WindowLocator : public QObject
{
    Q_OBJECT

public:
    using QObject::QObject;

    virtual bool start() = 0;
    virtual std::optional<WindowInfo> active() const = 0;

Q_SIGNALS:
    void changed();
};
