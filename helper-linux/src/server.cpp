#include "server.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QLocalSocket>

Server::Server(QString path, Handler handler, QObject *parent)
    : QObject(parent)
    , m_path(std::move(path))
    , m_handler(std::move(handler))
{
    connect(&m_server, &QLocalServer::newConnection, this, &Server::accept);
}

Server::~Server()
{
    for (auto it = m_pending.keyBegin(); it != m_pending.keyEnd(); ++it) (*it)->disconnect(this);
}

QString Server::defaultPath()
{
    const QString path = qEnvironmentVariable("FIGXIT_HELPER_SOCK");
    return path.isEmpty() ? QDir::homePath() + QStringLiteral("/.local/state/figxit/helper.sock") : path;
}

bool Server::start()
{
    const QString dir = QFileInfo(m_path).absolutePath();
    QDir().mkpath(dir);
    QFile::setPermissions(dir, QFile::ReadOwner | QFile::WriteOwner | QFile::ExeOwner);
    QLocalServer::removeServer(m_path);
    m_server.setSocketOptions(QLocalServer::UserAccessOption);
    return m_server.listen(m_path);
}

void Server::broadcast(const QByteArray &message)
{
    for (auto it = m_pending.keyBegin(); it != m_pending.keyEnd(); ++it) (*it)->write(message + '\n');
}

void Server::accept()
{
    while (QLocalSocket *socket = m_server.nextPendingConnection()) {
        m_pending.insert(socket, {});
        connect(socket, &QLocalSocket::readyRead, this, [this, socket] { read(socket); });
        connect(socket, &QLocalSocket::disconnected, this, [this, socket] {
            m_pending.remove(socket);
            socket->deleteLater();
        });
    }
}

void Server::read(QLocalSocket *socket)
{
    QByteArray buffer = m_pending.value(socket) + socket->readAll();
    qsizetype newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
        const QByteArray line = buffer.left(newline);
        buffer.remove(0, newline + 1);
        if (line.trimmed().isEmpty()) continue;
        const QByteArray reply = m_handler(line);
        if (!reply.isEmpty()) socket->write(reply + '\n');
    }
    if (m_pending.contains(socket)) m_pending.insert(socket, buffer);
}
