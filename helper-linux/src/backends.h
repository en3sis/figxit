#pragma once

#include <QString>
#include <memory>

class FocusTracker;
class PopupSurface;
class QWindow;
class WindowLocator;

std::unique_ptr<WindowLocator> startLocator(const QString &name);

std::unique_ptr<PopupSurface> makeSurface(QWindow *window);

std::unique_ptr<FocusTracker> startFocus();
