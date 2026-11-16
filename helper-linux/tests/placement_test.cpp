#include "../src/placement.h"
#include "../src/protocol.h"
#include "../src/terminals.h"

#include <QTest>

class PlacementTest : public QObject
{
    Q_OBJECT

    const QRectF window{100, 80, 987, 777};
    const QRectF textArea{0, -245, 580, 689};
    const QRectF scrollArea{0, 91, 597, 353};

    static Grid grid(const char *json)
    {
        return *Request::parse(QByteArray(R"({"cmd":"show","grid":)") + json + "}")->grid;
    }

    Fit fit(const char *json, std::optional<QRectF> base = std::nullopt, bool focused = false)
    {
        return ::fit(grid(json), base.value_or(window), focused, 1, false);
    }

private Q_SLOTS:
    void shellThatFillsTheWindowIsPlaced()
    {
        const Fit result = fit(R"({"cols":120,"rows":35,"col":6,"row":2,"cellPxW":8,"cellPxH":21,"pane":true})");
        QVERIFY(!result.split);
        QCOMPARE(result.placement->x, 148);
        QCOMPARE(result.placement->yTop, 80 + 42 + 42);
    }

    void halfWidthPaneWithoutAccessibilityIsASplit()
    {
        const Fit result = fit(R"({"cols":58,"rows":33,"col":6,"row":0,"cellPxW":8,"cellPxH":21,"pane":true})");
        QVERIFY(!result.placement);
        QVERIFY(result.split);
    }

    void tmuxInHalfTheWindowIsASplit()
    {
        const Fit result = fit(R"({"cols":58,"rows":33,"col":6,"row":0,"cellPxW":8,"cellPxH":21})");
        QVERIFY(!result.placement);
        QVERIFY(result.split);
    }

    void focusedPaneIsPlacedInsideThePane()
    {
        const Fit result = fit(R"({"cols":58,"rows":33,"col":6,"row":1,"cellPxW":8,"cellPxH":21,"pane":true})", QRectF(594, 141, 476, 715), true);
        QCOMPARE(result.placement->source, QStringLiteral("ax"));
        QCOMPARE(result.placement->x, 594 + 48);
        QCOMPARE(result.placement->yTop, 141 + 21);
    }

    void editorTerminalWithoutCellSizeUsesTheSurface()
    {
        const Fit result = fit(R"({"cols":149,"rows":25,"col":8,"row":3,"pane":true})", QRectF(455, 525, 1256, 425), true);
        QCOMPARE(result.placement->cellH, 17);
        QVERIFY(qAbs(result.placement->x - (455 + 8 * 1256.0 / 149)) < 0.001);
        QCOMPARE(result.placement->yTop, 525 + 51);
    }

    void cellSizeInPixelsOnAHiDpiScreenStillFits()
    {
        const Fit result = ::fit(grid(R"({"cols":120,"rows":35,"col":0,"row":0,"cellPxW":16,"cellPxH":42,"pane":true})"), window, false, 2, false);
        QVERIFY(!result.split);
        QCOMPARE(result.placement->cellW, 8);
    }

    void textAreaUnderATabBarCountsFromTheBottom()
    {
        const Fit result = fit(R"({"cols":100,"rows":40,"col":10,"row":0,"cellPxW":9,"cellPxH":17,"pane":true})", QRectF(0, 0, 920, 760));
        QCOMPARE(result.placement->yTop, 760 - 40 * 17);
        QCOMPARE(result.placement->x, 90);
    }

    void popupOpensUnderTheLine()
    {
        const Placement placement{QStringLiteral("cg"), {}, 8, 20, 300, 400, 420};
        QCOMPARE(popupRect(placement, QSize(260, 98), QRect(0, 0, 1920, 1080)), QRect(300, 422, 260, 98));
    }

    void popupOpensAboveTheLineNearTheBottom()
    {
        const Placement placement{QStringLiteral("cg"), {}, 8, 20, 300, 1000, 1020};
        QCOMPARE(popupRect(placement, QSize(260, 98), QRect(0, 0, 1920, 1080)), QRect(300, 1000 - 2 - 98, 260, 98));
    }

    void popupStaysOnItsScreen()
    {
        const Placement right{QStringLiteral("cg"), {}, 8, 20, 1800, 400, 420};
        QCOMPARE(popupRect(right, QSize(260, 98), QRect(1920, 0, 1920, 1080)).x(), 1920);
        QCOMPARE(popupRect(right, QSize(260, 98), QRect(0, 0, 1920, 1080)).x(), 1920 - 260);
    }

    void popupWithoutBoundsIsNotMoved()
    {
        const Placement placement{QStringLiteral("cg"), {}, 8, 20, 80, 58, 78};
        QCOMPARE(popupRect(placement, QSize(260, 98), QRect()), QRect(80, 80, 260, 98));
    }

    void textAreaIsClippedToItsScrollPane()
    {
        QCOMPARE(visibleSurface(textArea, true, scrollArea), QRectF(0, 91, 580, 353));
        QCOMPARE(visibleSurface(QRectF(0, -1148, 2540, 2593), true, QRectF(0, 98, 2557, 1333)), QRectF(0, 98, 2540, 1333));
    }

    void onlyAScrollPaneParentClipsTheSurface()
    {
        QCOMPARE(visibleSurface(textArea, false, scrollArea), textArea);
        QCOMPARE(visibleSurface(window, true, std::nullopt), window);
    }

    void surfaceThatMissesItsScrollPaneIsSkipped()
    {
        QVERIFY(!visibleSurface(textArea, true, QRectF(1000, 91, 597, 353)));
        QVERIFY(!visibleSurface(textArea, true, QRectF(0, 444, 597, 353)));
        QVERIFY(!visibleSurface(textArea, true, QRectF(0, 356.65, 597, 87.35)));
    }

    void surfaceOf100PixelsOrLessIsSkipped()
    {
        QVERIFY(!visibleSurface(QRectF(0, 0, 100, 689), false, std::nullopt));
        QVERIFY(!visibleSurface(QRectF(0, 0, 580, 100), false, std::nullopt));
        QCOMPARE(visibleSurface(textArea, true, QRectF(479, 91, 597, 353)), QRectF(479, 91, 101, 353));
    }

    void webDocumentPixelsBecomeLogicalPixels()
    {
        const QRectF canvas(374, 1118, 1611, 595);
        const QRectF global = toGlobal(canvas, QRectF(23, 14, 2161, 1774), QRectF(16, 10, 1490, 1223), QPointF(1500, 900));
        const qreal scaleX = 2161.0 / 1490;
        const qreal scaleY = 1774.0 / 1223;
        QVERIFY(qAbs(global.x() - (1500 + 351 / scaleX)) < 0.001);
        QVERIFY(qAbs(global.y() - (900 + 1104 / scaleY)) < 0.001);
        QVERIFY(qAbs(global.width() - 1611 / scaleX) < 0.001);
        QVERIFY(qAbs(scaleX - 1.45) < 0.001 && qAbs(scaleY - 1.45) < 0.001);
    }

    void nativeExtentsStartAtTheClientArea()
    {
        QCOMPARE(toGlobal(QRectF(0, 60, 900, 700), std::nullopt, std::nullopt, QPointF(100, 50)), QRectF(100, 110, 900, 700));
    }

    void ghosttyCellsAreInDevicePixels()
    {
        QVERIFY(terminalProfile(QStringLiteral("com.mitchellh.ghostty")).devicePixels);
        QVERIFY(!terminalProfile(QStringLiteral("org.kde.konsole")).devicePixels);
        QVERIFY(!terminalProfile(QString()).devicePixels);
    }

    void placementIsSentAsInProtocolSwift()
    {
        const Placement placement{QStringLiteral("ax"), QRectF(10, 20, 300, 200), 8, 18, 50, 60, 78};
        const QJsonObject json = placementJson(placement);
        QCOMPARE(json.value(QLatin1String("source")).toString(), QStringLiteral("ax"));
        QCOMPARE(json.value(QLatin1String("surface")).toObject().value(QLatin1String("w")).toDouble(), 300);
        QCOMPARE(json.value(QLatin1String("yBelow")).toDouble(), 78);
    }
};

QTEST_GUILESS_MAIN(PlacementTest)
#include "placement_test.moc"
