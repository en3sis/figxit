cmake_minimum_required(VERSION 3.22)
project(figxit-helper-linux LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE RelWithDebInfo)
endif()

find_package(Qt6 6.5 REQUIRED COMPONENTS Gui Network DBus Test)
find_package(LayerShellQt 6.6 REQUIRED)

add_library(figxit-core STATIC
  src/helper.cpp
  src/popup.cpp
  src/placement.cpp
  src/protocol.cpp
  src/terminals.cpp
  src/theme.cpp
  src/focus.h
  src/locator.h
)
target_compile_options(figxit-core PRIVATE -Wall -Wextra)
target_link_libraries(figxit-core PUBLIC Qt6::Gui Qt6::DBus)

add_executable(figxit-helper
  src/main.cpp
  src/server.cpp
  src/engine.cpp
  src/backends.cpp
  src/accessibility.cpp
  src/locator/kwin.cpp
  src/surface/layershell.cpp
  src/resources.qrc
)
set_target_properties(figxit-helper PROPERTIES AUTORCC ON)
target_compile_options(figxit-helper PRIVATE -Wall -Wextra)
target_link_libraries(figxit-helper PRIVATE figxit-core Qt6::Network Qt6::DBus LayerShellQt::Interface)

enable_testing()
add_executable(placement_test tests/placement_test.cpp)
target_link_libraries(placement_test PRIVATE figxit-core Qt6::Test)
add_test(NAME placement COMMAND placement_test)
add_executable(helper_test tests/helper_test.cpp)
target_link_libraries(helper_test PRIVATE figxit-core Qt6::Test)
add_test(NAME helper COMMAND helper_test)
