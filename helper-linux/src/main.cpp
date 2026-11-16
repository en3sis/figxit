#include "backends.h"
#include "engine.h"
#include "focus.h"
#include "helper.h"
#include "locator.h"
#include "popup.h"
#include "protocol.h"
#include "server.h"
#include "surface.h"
#include "theme.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QImage>
#include <QPainter>
#include <QScreen>
#include <QSocketNotifier>
#include <QTimer>
#include <csignal>
#include <cstdio>
#include <memory>
#include <fcntl.h>
#include <sys/file.h>
#include <unistd.h>

static int snapshot(const QStringList &args)
{
    const qsizetype at = args.indexOf(QStringLiteral("--snapshot"));
    if (at + 2 >= args.size()) {
        std::fprintf(stderr, "usage: figxit-helper --snapshot items.json out.png [--light | --dark] [--scale N]\n");
        return 2;
    }
    QFile file(args.at(at + 1));
    if (!file.open(QIODevice::ReadOnly)) return 2;
    const QList<Item> items = parseItems(file.readAll());
    const qsizetype scaleAt = args.indexOf(QStringLiteral("--scale"));
    const qreal scale = scaleAt >= 0 && scaleAt + 1 < args.size() ? args.at(scaleAt + 1).toDouble() : 2;

    ListWindow list;
    list.setItems(items, 0);
    const QSize size = list.sizeFor(items);
    QImage image(size * scale, QImage::Format_ARGB32_Premultiplied);
    image.setDevicePixelRatio(scale);
    image.fill(Qt::transparent);
    QPainter painter(&image);
    const bool dark = args.contains(QStringLiteral("--dark"));
    list.paint(painter, size, dark || args.contains(QStringLiteral("--light")) ? breezePalette(dark) : desktopPalette());
    painter.end();
    return image.save(args.at(at + 2)) ? 0 : 3;
}

static bool lockInstance(const QString &socket)
{
    QDir().mkpath(QFileInfo(socket).absolutePath());
    const int fd = ::open(QFile::encodeName(socket + QStringLiteral(".lock")).constData(), O_RDWR | O_CREAT | O_CLOEXEC, 0600);
    if (fd < 0) return true;
    if (::flock(fd, LOCK_EX | LOCK_NB) == 0) return true;
    ::close(fd);
    return false;
}

static int signalPipe[2];

static void quitOnSignals(QGuiApplication &app)
{
    if (::pipe2(signalPipe, O_CLOEXEC | O_NONBLOCK) != 0) return;
    auto *notifier = new QSocketNotifier(signalPipe[0], QSocketNotifier::Read, &app);
    QObject::connect(notifier, &QSocketNotifier::activated, &app, &QCoreApplication::quit);
    for (int signal : {SIGTERM, SIGINT, SIGHUP}) {
        std::signal(signal, [](int) {
            const char byte = 1;
            [[maybe_unused]] const auto written = ::write(signalPipe[1], &byte, 1);
        });
    }
}

static int locate()
{
    const std::unique_ptr<WindowLocator> started = startLocator(QStringLiteral("figxit-locator-locate"));
    if (!started) {
        std::fprintf(stderr, "figxit-helper: no window backend works on this desktop\n");
        return 1;
    }
    WindowLocator *locator = started.get();
    QObject::connect(locator, &WindowLocator::changed, [locator] {
        const std::optional<WindowInfo> window = locator->active();
        if (!window) {
            std::printf("no window\n");
        } else {
            const QRect &r = window->client;
            std::printf("%s pid=%lld app=%s client=%d,%d %dx%d output=%s scale=%.3f\n", qPrintable(window->id), window->pid,
                        qPrintable(window->appId), r.x(), r.y(), r.width(), r.height(), qPrintable(window->output), window->scale);
            for (QScreen *screen : QGuiApplication::screens())
                if (screen->name() == window->output)
                    std::printf("  screen %s geometry=%d,%d %dx%d dpr=%.3f\n", qPrintable(screen->name()), screen->geometry().x(), screen->geometry().y(),
                                screen->geometry().width(), screen->geometry().height(), screen->devicePixelRatio());
        }
        std::fflush(stdout);
    });
    return qApp->exec();
}

static void markStopped(const QString &socket, bool stopped)
{
    QFile flag(QFileInfo(socket).absolutePath() + QStringLiteral("/stopped"));
    if (stopped) {
        if (flag.open(QIODevice::WriteOnly)) flag.close();
    } else {
        flag.remove();
    }
}

static QString locatorName(const QString &socket)
{
    if (!qEnvironmentVariableIsSet("FIGXIT_HELPER_SOCK")) return QStringLiteral("figxit-locator");
    return QStringLiteral("figxit-locator-") + QString::number(qHash(socket), 16);
}

int main(int argc, char **argv)
{
    std::signal(SIGPIPE, SIG_IGN);
    const auto hasArg = [&](const char *name) {
        for (int i = 1; i < argc; ++i)
            if (qstrcmp(argv[i], name) == 0) return true;
        return false;
    };
    const bool snapshotting = hasArg("--snapshot");
    const bool locating = hasArg("--locate");
    if (snapshotting) qputenv("QT_QPA_PLATFORM", "offscreen");
    qputenv("QT_QPA_PLATFORMTHEME", "generic");

    const QString socket = Server::defaultPath();
    if (!snapshotting && !locating && !lockInstance(socket)) {
        std::fprintf(stderr, "figxit-helper: already running at %s\n", qPrintable(socket));
        return 0;
    }

    QGuiApplication app(argc, argv);
    QGuiApplication::setApplicationName(QStringLiteral("figxit-helper"));
    QGuiApplication::setQuitOnLastWindowClosed(false);
    if (snapshotting) return snapshot(QGuiApplication::arguments());
    quitOnSignals(app);
    if (locating) return locate();

    ListWindow window;
    Helper::Backends backends{makeSurface(&window), startLocator(locatorName(socket)), startFocus()};
    if (!backends.locator) std::fprintf(stderr, "figxit-helper: no window backend for this desktop, the list opens at a fixed place\n");
    Helper helper(&window, std::move(backends));
    Server server(socket, [&helper](const QByteArray &line) { return helper.handle(line); });
    QObject::connect(&helper, &Helper::hidden, &server, [&server] { server.broadcast(QByteArrayLiteral(R"({"event":"hidden"})")); });
    QObject::connect(&helper, &Helper::quitRequested, &app, [&socket] {
        markStopped(socket, true);
        QTimer::singleShot(0, qApp, &QCoreApplication::quit);
    });
    if (!server.start()) {
        std::fprintf(stderr, "figxit-helper: cannot listen at %s\n", qPrintable(socket));
        return 1;
    }
    desktopPalette();
    const std::unique_ptr<EngineSupervisor> engine = EngineSupervisor::create();
    if (engine) {
        markStopped(socket, false);
        engine->start();
    }
    return app.exec();
}
