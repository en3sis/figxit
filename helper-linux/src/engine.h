#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QProcess>
#include <QString>
#include <memory>

class EngineSupervisor : public QObject
{
    Q_OBJECT

public:
    static std::unique_ptr<EngineSupervisor> create();

    explicit EngineSupervisor(QString program);
    ~EngineSupervisor() override;

    void start();
    void stop();

private:
    void exited();

    QString m_program;
    QProcess m_process;
    QElapsedTimer m_started;
    int m_failures = 0;
    bool m_stopping = false;
};
