#include "diagnostics/CrashHandler.hpp"

#include <execinfo.h>
#include <fcntl.h>
#include <unistd.h>

#include <csignal>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <system_error>

namespace dof::diagnostics {

namespace {

constexpr int kMaxFrames = 64;

// Filled at install time (allocation-free thereafter). The signal handler reads
// only these fixed buffers plus async-signal-safe syscalls, so it never mallocs.
char                 g_dumpPath[4096] = {};
char                 g_versionLabel[256] = {};
volatile sig_atomic_t g_isInstalled = 0;

const int kFatalSignals[] = {SIGSEGV, SIGABRT, SIGFPE, SIGILL, SIGBUS};

const char* resolveSignalName(int signalNumber) {
    switch (signalNumber) {
        case SIGSEGV: return "SIGSEGV";
        case SIGABRT: return "SIGABRT";
        case SIGFPE:  return "SIGFPE";
        case SIGILL:  return "SIGILL";
        case SIGBUS:  return "SIGBUS";
        default:      return "UNKNOWN";
    }
}

// write(2)-based output — strlen + write are async-signal-safe, unlike the
// std::ostream / printf family which may allocate or take locks.
void writeRaw(int fileDescriptor, const char* text) {
    if (text == nullptr) return;
    const auto length = static_cast<ssize_t>(std::strlen(text));
    ssize_t written = 0;
    while (written < length) {
        const ssize_t chunk =
            ::write(fileDescriptor, text + written, static_cast<size_t>(length - written));
        if (chunk <= 0) break;
        written += chunk;
    }
}

void dumpReport(int fileDescriptor, int signalNumber, void* const* frames, int frameCount) {
    writeRaw(fileDescriptor, "\n=== dogmax crash ===\nsignal: ");
    writeRaw(fileDescriptor, resolveSignalName(signalNumber));
    writeRaw(fileDescriptor, "\nbuild: ");
    writeRaw(fileDescriptor, g_versionLabel);
    writeRaw(fileDescriptor, "\nbacktrace:\n");
    backtrace_symbols_fd(frames, frameCount, fileDescriptor);
    writeRaw(fileDescriptor, "=== end crash ===\n");
}

extern "C" void handleFatalSignal(int signalNumber) {
    void*     frames[kMaxFrames];
    const int frameCount = backtrace(frames, kMaxFrames);

    const int fileDescriptor = ::open(g_dumpPath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fileDescriptor >= 0) {
        dumpReport(fileDescriptor, signalNumber, frames, frameCount);
        ::close(fileDescriptor);
    }
    dumpReport(STDERR_FILENO, signalNumber, frames, frameCount);

    // SA_RESETHAND already restored the default disposition on entry; re-raise so
    // the OS still cores and the process reports the genuine crash status instead
    // of us swallowing it.
    ::raise(signalNumber);
}

}  // namespace

bool installCrashHandler(const std::string& dumpDirectory, const std::string& versionLabel) {
    std::error_code errorCode;
    std::filesystem::create_directories(dumpDirectory, errorCode);

    const std::time_t now = std::time(nullptr);
    std::tm            utc{};
    ::gmtime_r(&now, &utc);
    char timestamp[32];
    std::strftime(timestamp, sizeof(timestamp), "%Y%m%d-%H%M%S", &utc);

    const std::filesystem::path fullPath =
        std::filesystem::path(dumpDirectory) /
        ("crash-" + std::string(timestamp) + "-" + std::to_string(::getpid()) + ".txt");
    std::snprintf(g_dumpPath, sizeof(g_dumpPath), "%s", fullPath.string().c_str());
    std::snprintf(g_versionLabel, sizeof(g_versionLabel), "%s", versionLabel.c_str());

    // Warm up the libgcc unwinder so the first call inside the signal handler does
    // not lazily dlopen / malloc on the crash path.
    void* warmup[1];
    backtrace(warmup, 1);

    struct sigaction action{};
    action.sa_handler = handleFatalSignal;
    sigemptyset(&action.sa_mask);
    // SA_RESETHAND restores SIG_DFL on entry, so a fault inside the handler dies
    // immediately instead of recursing forever.
    action.sa_flags = SA_RESETHAND;

    bool installedAll = true;
    for (int signalNumber : kFatalSignals) {
        if (sigaction(signalNumber, &action, nullptr) != 0) installedAll = false;
    }
    g_isInstalled = 1;
    return installedAll;
}

std::string plannedDumpPath() {
    if (g_isInstalled == 0) return {};
    return std::string(g_dumpPath);
}

}  // namespace dof::diagnostics
