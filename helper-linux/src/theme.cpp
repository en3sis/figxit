#include "theme.h"

#include <QDBusConnection>
#include <QDBusMessage>
#include <QDBusPendingCallWatcher>
#include <QDBusVariant>
#include <QDir>
#include <QFile>
#include <optional>

namespace
{

std::optional<bool> portalDark;

std::optional<uint> colorScheme(const QDBusMessage &reply)
{
    if (reply.type() != QDBusMessage::ReplyMessage || reply.arguments().isEmpty()) return std::nullopt;
    QVariant value = reply.arguments().at(0);
    while (value.metaType() == QMetaType::fromType<QDBusVariant>()) value = value.value<QDBusVariant>().variant();
    bool ok = false;
    const uint scheme = value.toUInt(&ok);
    return ok ? std::optional(scheme) : std::nullopt;
}

void askPortal(const QString &method = QStringLiteral("ReadOne"))
{
    QDBusMessage call = QDBusMessage::createMethodCall(QStringLiteral("org.freedesktop.portal.Desktop"), QStringLiteral("/org/freedesktop/portal/desktop"),
                                                       QStringLiteral("org.freedesktop.portal.Settings"), method);
    call << QStringLiteral("org.freedesktop.appearance") << QStringLiteral("color-scheme");
    auto *watcher = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(call, 1000));
    QObject::connect(watcher, &QDBusPendingCallWatcher::finished, [method](QDBusPendingCallWatcher *finished) {
        finished->deleteLater();
        if (const std::optional<uint> scheme = colorScheme(finished->reply())) portalDark = *scheme == 1;
        else if (method == QLatin1String("ReadOne")) askPortal(QStringLiteral("Read"));
    });
}

}

QPalette breezePalette(bool dark)
{
    QPalette palette;
    palette.setColor(QPalette::Window, dark ? QColor(32, 35, 38) : QColor(239, 240, 241));
    palette.setColor(QPalette::WindowText, dark ? QColor(252, 252, 252) : QColor(35, 38, 41));
    palette.setColor(QPalette::Highlight, QColor(61, 174, 233));
    palette.setColor(QPalette::HighlightedText, QColor(252, 252, 252));
    return palette;
}

QPalette paletteFromKdeGlobals(const QString &text)
{
    QPalette palette = breezePalette(false);
    QString section;
    for (const QString &raw : text.split(QLatin1Char('\n'))) {
        const QString line = raw.trimmed();
        if (line.startsWith(QLatin1Char('['))) {
            section = line;
            continue;
        }
        const qsizetype equals = line.indexOf(QLatin1Char('='));
        if (equals < 0) continue;
        const QStringList rgb = line.mid(equals + 1).split(QLatin1Char(','));
        if (rgb.size() < 3) continue;
        const QColor color(rgb.at(0).trimmed().toInt(), rgb.at(1).trimmed().toInt(), rgb.at(2).trimmed().toInt());
        const QString key = section + line.left(equals).trimmed();
        if (key == QLatin1String("[Colors:Window]BackgroundNormal")) palette.setColor(QPalette::Window, color);
        else if (key == QLatin1String("[Colors:Window]ForegroundNormal")) palette.setColor(QPalette::WindowText, color);
        else if (key == QLatin1String("[Colors:Selection]BackgroundNormal")) palette.setColor(QPalette::Highlight, color);
        else if (key == QLatin1String("[Colors:Selection]ForegroundNormal")) palette.setColor(QPalette::HighlightedText, color);
    }
    return palette;
}

QPalette desktopPalette()
{
    QString config = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (!config.startsWith(QLatin1Char('/'))) config = QDir::homePath() + QStringLiteral("/.config");
    QFile file(config + QStringLiteral("/kdeglobals"));
    if (file.open(QIODevice::ReadOnly)) {
        const QString text = QString::fromUtf8(file.readAll());
        if (text.contains(QLatin1String("[Colors:Window]"))) return paletteFromKdeGlobals(text);
    }
    askPortal();
    return breezePalette(portalDark.value_or(false));
}
