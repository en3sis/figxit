#pragma once

#include <QByteArray>
#include <QHash>
#include <QLocalServer>
#include <QString>
#include <functional>

class QLocalSocket;

class Server : public QObject
{
    Q_OBJECT

public:
    using Handler = std::function<QByteArray(const QByteArray &line)>;

    Server(QString path, Handler handler, QObject *parent = nullptr);
    ~Server() override;

    static QString defaultPath();

    bool start();
    void broadcast(const QByteArray &message);

private:
    void accept();
    void read(QLocalSocket *socket);

    QString m_path;
    Handler m_handler;
    QLocalServer m_server;
    QHash<QLocalSocket *, QByteArray> m_pending;
};
