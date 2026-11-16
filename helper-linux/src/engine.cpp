#include "engine.h"

#include <QCoreApplication>
#include <QFileInfo>
#include <QTimer>
#include <cmath>

std::unique_ptr<EngineSupervisor> EngineSupervisor::create()
{
    if (qEnvironmentVariableIsSet("FIGXIT_NO_ENGINE")) return nullptr;
    const QString program = QCoreApplication::applicationDirPath() + QStringLiteral("/figxit-engine");
    const QFileInfo info(program);
    if (!info.isFile() || !info.isExecutable()) return nullptr;
    return std::make_unique<EngineSupervisor>(program);
}

EngineSupervisor::EngineSupervisor(QString program)
    : m_program(std::move(program))
{
    m_process.setProgram(m_program);
    m_process.setArguments({QStringLiteral("daemon")});
    m_process.setStandardInputFile(QProcess::nullDevice());
    m_process.setStandardOutputFile(QProcess::nullDevice());
    m_process.setStandardErrorFile(QProcess::nullDevice());
    connect(&m_process, &QProcess::finished, this, &EngineSupervisor::exited);
    connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart) exited();
    });
}

EngineSupervisor::~EngineSupervisor()
{
    stop();
}

void EngineSupervisor::start()
{
    if (m_process.state() != QProcess::NotRunning) return;
    m_started.start();
    m_process.start();
}

void EngineSupervisor::exited()
{
    if (m_stopping) return;
    m_failures = m_started.isValid() && m_started.elapsed() < 5000 ? m_failures + 1 : 0;
    if (m_failures >= 5) return;
    QTimer::singleShot(int(500 * std::pow(2, m_failures)), this, [this] {
        if (!m_stopping) start();
    });
}

void EngineSupervisor::stop()
{
    m_stopping = true;
    if (m_process.state() == QProcess::NotRunning) return;
    m_process.terminate();
    if (!m_process.waitForFinished(2000)) m_process.kill();
}
