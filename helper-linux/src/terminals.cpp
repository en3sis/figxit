#include "terminals.h"

namespace
{

struct Known {
    const char *appId;
    TerminalProfile profile;
};

const Known known[] = {
    {"com.mitchellh.ghostty", {.devicePixels = true}},
};

}

TerminalProfile terminalProfile(const QString &appId)
{
    for (const Known &terminal : known)
        if (appId == QLatin1String(terminal.appId)) return terminal.profile;
    return {};
}
