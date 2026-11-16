#pragma once

#include <QRect>

class QScreen;

class PopupSurface
{
public:
    virtual ~PopupSurface() = default;

    virtual void place(const QRect &rect, QScreen *screen) = 0;
};
