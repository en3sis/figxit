#include "../src/focus.h"
#include "../src/helper.h"
#include "../src/locator.h"
#include "../src/popup.h"
#include "../src/surface.h"

#include <QGuiApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSignalSpy>
#include <QTest>
#include <memory>

namespace
{

class FakeSurface : public PopupSurface
{
public:
    void place(const QRect &rect, QScreen *) override { places.append(rect); }

    QList<QRect> places;
};

class FakeLocator : public WindowLocator
{
public:
    bool start() override { return true; }
    std::optional<WindowInfo> active() const override { return current; }

    void activate(std::optional<WindowInfo> window)
    {
        current = std::move(window);
        Q_EMIT changed();
    }

    std::optional<WindowInfo> current;
};

class FakeFocus : public FocusTracker
{
public:
    std::optional<QRectF> surface(qint64 pid, QPoint) override { return pid == areaPid ? area : std::nullopt; }
    QString focusedId() const override { return focused; }

    void moveTo(const QString &id)
    {
        focused = id;
        Q_EMIT focusChanged();
    }

    std::optional<QRectF> area;
    qint64 areaPid = 0;
    QString focused;
};

const WindowInfo konsole{QStringLiteral("w1"), 42, QStringLiteral("org.kde.konsole"), QRect(0, 0, 800, 600), QString(), 1};

const QByteArray showRequest = R"({"cmd":"show","grid":{"cols":100,"rows":30,"col":10,"row":5,"cellPxW":8,"cellPxH":20,"pane":true},)"
                        R"("items":[{"label":"build"},{"label":"deploy"}],"selected":0})";

struct Parts {
    bool surface = true;
    bool locator = true;
    bool focus = false;
};

struct Rig {
    explicit Rig(Parts parts = {})
    {
        Helper::Backends backends;
        if (parts.surface) {
            auto made = std::make_unique<FakeSurface>();
            surface = made.get();
            backends.surface = std::move(made);
        }
        if (parts.locator) {
            auto made = std::make_unique<FakeLocator>();
            locator = made.get();
            backends.locator = std::move(made);
        }
        if (parts.focus) {
            auto made = std::make_unique<FakeFocus>();
            focus = made.get();
            backends.focus = std::move(made);
        }
        helper = std::make_unique<Helper>(&window, std::move(backends));
        hidden = std::make_unique<QSignalSpy>(helper.get(), &Helper::hidden);
    }

    QJsonObject send(const QByteArray &line) { return QJsonDocument::fromJson(helper->handle(line)).object(); }

    ListWindow window;
    FakeSurface *surface = nullptr;
    FakeLocator *locator = nullptr;
    FakeFocus *focus = nullptr;
    std::unique_ptr<Helper> helper;
    std::unique_ptr<QSignalSpy> hidden;
};

bool ok(const QJsonObject &reply)
{
    return reply.value(QLatin1String("ok")).toBool();
}

QString error(const QJsonObject &reply)
{
    return reply.value(QLatin1String("error")).toString();
}

const QByteArray selectRequest = R"({"cmd":"select","selected":1})";

}

class HelperTest : public QObject
{
    Q_OBJECT

private Q_SLOTS:
    void listOpensUnderTheCursorInTheActiveWindow()
    {
        Rig rig;
        rig.locator->current = konsole;
        QVERIFY(ok(rig.send(showRequest)));
        QCOMPARE(rig.surface->places.size(), 1);
        QCOMPARE(rig.surface->places.at(0).topLeft(), QPoint(80, 122));
        QVERIFY(rig.window.isVisible());
        QCOMPARE(rig.hidden->count(), 0);
    }

    void noActiveWindowOpensNothing()
    {
        Rig rig;
        const QJsonObject reply = rig.send(showRequest);
        QVERIFY(!ok(reply));
        QCOMPARE(error(reply), QStringLiteral("no terminal window"));
        QVERIFY(rig.surface->places.isEmpty());
        QCOMPARE(rig.hidden->count(), 1);
    }

    void withoutLocatorTheListOpensAtTheFixedPlace()
    {
        qunsetenv("FIGXIT_POPUP_AT");
        Rig rig({.locator = false});
        QVERIFY(ok(rig.send(showRequest)));
        QCOMPARE(rig.surface->places.at(0).topLeft(), QPoint(80, 80));
    }

    void withoutSurfaceTheListCannotOpen()
    {
        Rig rig({.surface = false});
        rig.locator->current = konsole;
        const QJsonObject reply = rig.send(showRequest);
        QCOMPARE(error(reply), QStringLiteral("no way to place the list on this desktop"));
        QCOMPARE(rig.hidden->count(), 1);
    }

    void movedWindowPlacesTheListAgain()
    {
        Rig rig;
        rig.locator->current = konsole;
        QVERIFY(ok(rig.send(showRequest)));
        WindowInfo moved = konsole;
        moved.client.translate(10, 20);
        rig.locator->activate(moved);
        QCOMPARE(rig.surface->places.size(), 2);
        QCOMPARE(rig.surface->places.at(1).topLeft(), QPoint(90, 142));
        QCOMPARE(rig.hidden->count(), 0);
    }

    void anotherActiveWindowClosesTheList()
    {
        Rig rig;
        rig.locator->current = konsole;
        QVERIFY(ok(rig.send(showRequest)));
        WindowInfo browser = konsole;
        browser.id = QStringLiteral("w2");
        browser.pid = 7;
        rig.locator->activate(browser);
        QCOMPARE(rig.hidden->count(), 1);
        QVERIFY(!rig.window.isVisible());
        QCOMPARE(error(rig.send(selectRequest)), QStringLiteral("nothing shown"));
    }

    void focusMovingInsideTheAppClosesTheList()
    {
        Rig rig({.focus = true});
        rig.locator->current = konsole;
        rig.focus->area = QRectF(100, 300, 600, 300);
        rig.focus->areaPid = konsole.pid;
        rig.focus->focused = QStringLiteral("terminal");
        QVERIFY(ok(rig.send(showRequest)));
        QVERIFY(ok(rig.send(selectRequest)));

        rig.focus->moveTo(QStringLiteral("editor"));
        QCOMPARE(rig.hidden->count(), 1);
        QVERIFY(!rig.window.isVisible());
        QCOMPARE(error(rig.send(selectRequest)), QStringLiteral("nothing shown"));
    }

    void focusMovingWithoutAnAreaKeepsTheList()
    {
        Rig rig({.focus = true});
        rig.locator->current = konsole;
        rig.focus->focused = QStringLiteral("somewhere");
        QVERIFY(ok(rig.send(showRequest)));
        rig.focus->moveTo(QStringLiteral("elsewhere"));
        QCOMPARE(rig.hidden->count(), 0);
        QVERIFY(ok(rig.send(selectRequest)));
    }

    void hideFromTheEngineIsNotReportedBack()
    {
        Rig rig;
        rig.locator->current = konsole;
        QVERIFY(ok(rig.send(showRequest)));
        QVERIFY(ok(rig.send(R"({"cmd":"hide"})")));
        QVERIFY(!rig.window.isVisible());
        QCOMPARE(rig.hidden->count(), 0);
    }

    void probeTellsWhetherAtSpiIsOnAndWhereTheListWouldOpen()
    {
        Rig rig;
        rig.locator->current = konsole;
        const QJsonObject reply = rig.send(R"({"cmd":"probe","grid":{"cols":100,"rows":30,"col":10,"row":5,"cellPxW":8,"cellPxH":20,"pane":true}})");
        QCOMPARE(reply.value(QLatin1String("axTrusted")).toBool(), false);
        QCOMPARE(reply.value(QLatin1String("app")).toString(), konsole.appId);
        QCOMPARE(reply.value(QLatin1String("placement")).toObject().value(QLatin1String("x")).toDouble(), 80);
        QCOMPARE(reply.value(QLatin1String("split")).toBool(), false);

        Rig withFocus({.focus = true});
        QCOMPARE(withFocus.send(R"({"cmd":"probe"})").value(QLatin1String("axTrusted")).toBool(), true);
    }

    void quitHidesTheListAndAsksToQuit()
    {
        Rig rig;
        rig.locator->current = konsole;
        QSignalSpy quit(rig.helper.get(), &Helper::quitRequested);
        QVERIFY(ok(rig.send(showRequest)));
        QVERIFY(ok(rig.send(R"({"cmd":"quit"})")));
        QCOMPARE(quit.count(), 1);
        QVERIFY(!rig.window.isVisible());
    }

    void badRequestsAreAnswered()
    {
        Rig rig;
        QCOMPARE(error(rig.send("not json")), QStringLiteral("bad request"));
        QCOMPARE(error(rig.send(R"({"cmd":"show"})")), QStringLiteral("show needs grid and items"));
        QCOMPARE(error(rig.send(R"({"cmd":"dance"})")), QStringLiteral("unknown cmd"));
    }
};

int main(int argc, char **argv)
{
    qputenv("QT_QPA_PLATFORM", "offscreen");
    QGuiApplication app(argc, argv);
    HelperTest test;
    return QTest::qExec(&test, argc, argv);
}

#include "helper_test.moc"
