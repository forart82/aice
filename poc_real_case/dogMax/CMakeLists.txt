cmake_minimum_required(VERSION 3.20)
project(dogmax CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Build acceleration — each tool is used only when installed, so the build
# never breaks if it is missing. Install them with:
#   sudo apt install ccache mold ninja-build
# (Ninja is selected at configure time: cmake -S . -B build -G Ninja)
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "ccache enabled: ${CCACHE_PROGRAM}")
endif()

find_program(MOLD_LINKER mold)
find_program(LLD_LINKER ld.lld)
if(MOLD_LINKER)
    add_link_options(-fuse-ld=mold)
    message(STATUS "Fast linker enabled: mold")
elseif(LLD_LINKER)
    add_link_options(-fuse-ld=lld)
    message(STATUS "Fast linker enabled: lld")
endif()

# DOGMAX_FAST switches on a dedicated fast build dir (build-dev/, driven by
# `./bt dev`): -O1 -g0, no split-dwarf / gdb-index / rdynamic. It keeps ccache
# hits high and slashes compile+link time for the edit->test loop. The default
# (OFF, build/) stays the -O3 + full-debug crash-traceable build.
option(DOGMAX_FAST "Fast dev build for build-dev/: -O1 -g0, no split-dwarf/gdb-index." OFF)

if(DOGMAX_FAST)
    # Neutral build type so Release's -O3/-DNDEBUG do not fight the -O1 below;
    # asserts stay live in dev, which surfaces bugs the -O3 snapshot would hide.
    set(CMAKE_BUILD_TYPE "" CACHE STRING "" FORCE)
elseif(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

option(SFML_STATIC_LIBRARIES "Link SFML statically" TRUE)

if(NOT CMAKE_PREFIX_PATH)
    set(CMAKE_PREFIX_PATH "/home/forart/dev/SFML/install" CACHE PATH "" FORCE)
endif()

find_package(SFML 3 COMPONENTS Graphics Window System Audio REQUIRED)

add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)

# Floating-point determinism — bit-reproducible float results across platforms/runs.
#   -ffp-contract=off : forbid FMA contraction (a*b+c fused), the main silent divergence.
#   -mfpmath=sse      : SSE math, no x87 80-bit intermediates -> FLT_EVAL_METHOD == 0.
# Never add -ffast-math / -funsafe-math-optimizations / -Ofast here: they break determinism.
add_compile_options(-ffp-contract=off)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64|i.86|i386")
    add_compile_options(-mfpmath=sse -msse2)
endif()
if(CMAKE_CXX_FLAGS MATCHES "fast-math|funsafe-math|-Ofast")
    message(FATAL_ERROR "Fast-math flags break float determinism; remove them.")
endif()

# Debug info + crash-traceability. The default Release build (build/) keeps full
# debug line info, split-dwarf, a gdb-index and the dynamic symbol table so the
# app crash handler's backtrace prints real function names + source locations.
# The fast dev build (DOGMAX_FAST, build-dev/) drops ALL of it — -g0 and no
# split-dwarf/gdb-index/rdynamic is precisely what keeps compile+link fast and the
# objects ccache-cacheable. -O1 gives most of -O0's compile speed with far quicker
# test execution.
if(DOGMAX_FAST)
    add_compile_options(-O1 -g0)
else()
    # Embed the FULL DWARF in the binary (do NOT split it into .dwo). The root
    # snapshot dogmax-<ts> is a COPY of build/dogmax; split-dwarf leaves the line
    # info in build/CMakeFiles/**/*.dwo, which do not travel with that copy, so the
    # snapshot's crash backtrace / addr2line resolved only `??:?` — defeating the
    # whole point of these flags. Embedded -g makes the snapshot self-contained:
    # real source file+line from the binary alone, anywhere. -rdynamic exports the
    # dynamic symbol table so function names also appear in backtraces.
    # Do NOT re-add -gsplit-dwarf/--gdb-index here without making the .dwo travel
    # with the snapshot — it silently re-breaks snapshot line info.
    add_compile_options(-g)
    add_link_options(-rdynamic)
endif()

file(GLOB_RECURSE GAME_SOURCES CONFIGURE_DEPENDS
    src/*.cpp
)
list(FILTER GAME_SOURCES EXCLUDE REGEX ".*main\\.cpp$")

add_library(dogcore STATIC ${GAME_SOURCES})
target_include_directories(dogcore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
)
target_link_libraries(dogcore PUBLIC
    SFML::Graphics
    SFML::Window
    SFML::System
    SFML::Audio
)

# Precompiled headers — the most frequently included STL + SFML headers across
# ~335 translation units. Cuts full-rebuild time by 30-50%.
target_precompile_headers(dogcore PRIVATE
    <vector> <string> <algorithm> <cmath> <cstdint> <memory>
    <sstream> <optional> <functional> <unordered_map>
    <SFML/System/Vector2.hpp>
    <SFML/Graphics/RenderWindow.hpp>
    <SFML/Graphics/Color.hpp>
    <SFML/Graphics/RectangleShape.hpp>
    <SFML/Graphics/Text.hpp>
    <SFML/Graphics/Font.hpp>
    <SFML/Graphics/Rect.hpp>
)

add_executable(dogmax src/main.cpp)
target_link_libraries(dogmax PRIVATE dogcore)

# Stage configs/ and assets/ into the build dir once at configure time instead
# of copying them on every POST_BUILD (saves 1-3 seconds per build).
# NOTE: version_build.yaml lives only in ${CMAKE_BINARY_DIR}/configs/ (the build
# number file) so it is NOT overwritten by the symlink — we copy configs/ once
# at configure time to ensure a real directory exists, then bump after each build.
if(NOT IS_DIRECTORY "${CMAKE_BINARY_DIR}/configs")
    file(COPY ${CMAKE_CURRENT_SOURCE_DIR}/configs DESTINATION ${CMAKE_BINARY_DIR})
endif()
if(NOT IS_DIRECTORY "${CMAKE_BINARY_DIR}/assets")
    execute_process(COMMAND ${CMAKE_COMMAND} -E create_symlink
        ${CMAKE_CURRENT_SOURCE_DIR}/assets ${CMAKE_BINARY_DIR}/assets)
endif()

add_custom_command(TARGET dogmax POST_BUILD
    # Auto-increment the on-screen build number (see cmake/BumpBuildNumber.cmake).
    COMMAND ${CMAKE_COMMAND}
        -DVERSION_BUILD_FILE=${CMAKE_BINARY_DIR}/configs/version_build.yaml
        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/BumpBuildNumber.cmake
)

# ============================================================================
# TEST TARGET — Rule 1 (Zero-Code Without Test) and Rule 14 (Quality Gate).
#
# Opt-in via -DDOGMAX_TESTS=ON so the normal game build pays nothing for it.
# `./verify` configures a separate build-test/ directory with this ON.
#
# doctest is header-only and MIT — Rule 7 clear. Vendored under third_party/ so
# the suite builds with no network and no package manager, which matters because
# a quality gate that can fail for environmental reasons stops being run.
#
# The suite links dogcore, so domain code is tested AS SHIPPED rather than
# recompiled with different flags. Tests needing a window or GL context do not
# belong here: Rule 6 requires domain logic to be headless, and anything that
# cannot run headlessly is telling you it is in the wrong layer.
# ============================================================================
option(DOGMAX_TESTS "Build the doctest suite and register it with CTest." OFF)

if(DOGMAX_TESTS)
    enable_testing()

    file(GLOB_RECURSE DOGMAX_TEST_SOURCES CONFIGURE_DEPENDS
        ${CMAKE_CURRENT_SOURCE_DIR}/tests/*.cpp)

    if(DOGMAX_TEST_SOURCES)
        add_executable(dogmax_tests ${DOGMAX_TEST_SOURCES})
        target_link_libraries(dogmax_tests PRIVATE dogcore)
        target_include_directories(dogmax_tests PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/third_party/doctest
            ${CMAKE_CURRENT_SOURCE_DIR}/src)

        # Warnings as errors on the test target ONLY. This is the C++ stand-in
        # for the original protocol's `tsc --noEmit` strict typecheck step, and
        # scoping it here keeps it from blocking work in legacy game code that
        # predates the rule.
        target_compile_options(dogmax_tests PRIVATE -Wall -Wextra -Werror)

        add_test(NAME dogmax_suite COMMAND dogmax_tests)
    else()
        message(WARNING "DOGMAX_TESTS=ON but tests/ contains no .cpp files yet.")
    endif()
endif()
