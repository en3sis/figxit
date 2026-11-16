#pragma once

#include <QString>

struct TerminalProfile {
    bool devicePixels = false;
};

TerminalProfile terminalProfile(const QString &appId);
