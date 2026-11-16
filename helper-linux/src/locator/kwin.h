#pragma once

#include "../locator.h"

class KWinLocator : public WindowLocator
{
    Q_OBJECT
    Q_CLASSINFO("D-Bus Interface", "org.figxit.Locator")

public:
    explicit KWinLocator(QString name, QObject *parent = nullptr);
    ~KWinLocator() override;

    static bool available();

    bool start() override;
    std::optional<WindowInfo> active() const override;

public Q_SLOTS:
    Q_SCRIPTABLE void window(const QString &json);
    Q_SCRIPTABLE void noWindow();

private:
    QString m_name;
    std::optional<WindowInfo> m_active;
    bool m_loaded = false;
};
