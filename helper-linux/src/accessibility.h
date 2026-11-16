#pragma once

#include "focus.h"

#include <QDBusConnection>
#include <QHash>
#include <QPoint>
#include <QRectF>
#include <QString>
#include <optional>

class QDBusMessage;

class AccessibleFocus : public FocusTracker
{
    Q_OBJECT

public:
    explicit AccessibleFocus(QObject *parent = nullptr);

    bool start();

    std::optional<QRectF> surface(qint64 pid, QPoint client) override;
    QString focusedId() const override;

private Q_SLOTS:
    void stateChanged(const QDBusMessage &message);

private:
    struct Node {
        QString service;
        QString path;
        bool operator==(const Node &) const = default;
    };

    struct Path {
        Node area;
        std::optional<Node> clip;
        std::optional<Node> document;
        std::optional<Node> host;
    };

    std::optional<Path> findPath(const Node &focused);
    std::optional<QRectF> measure(const Path &path, QPoint client);
    qint64 pidOf(const QString &service);
    std::optional<QRectF> extents(const Node &node);
    std::optional<Node> parent(const Node &node);
    uint role(const Node &node);

    QDBusConnection m_bus;
    std::optional<Node> m_focused;
    std::optional<Path> m_path;
    QHash<QString, qint64> m_pids;
};
