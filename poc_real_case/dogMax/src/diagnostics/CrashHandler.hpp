#pragma once

#include <string>

namespace dof::diagnostics {

// Installs async-signal-safe handlers for the fatal signals (SIGSEGV, SIGABRT,
// SIGFPE, SIGILL, SIGBUS). On a crash the handler writes a backtrace to a
// per-process file under `dumpDirectory` (named crash-<utc>-<pid>.txt) and to
// stderr, then re-raises the signal with its default disposition so the OS can
// still produce a core dump and report the true exit status.
//
// `versionLabel` is stamped into the dump header so a crash file names the exact
// build that produced it. The directory and label are copied into fixed-size
// internal buffers at install time, so nothing the handler itself touches
// allocates — the handler stays async-signal-safe.
//
// Returns true if every handler was installed. Safe to call once near process
// start; a later call replaces the stored directory/label and re-arms.
bool installCrashHandler(const std::string& dumpDirectory, const std::string& versionLabel);

// Test/inspection seam: the absolute path of the dump file the next crash would
// write, given the directory the handler was last installed with. Empty string
// if the handler has not been installed.
std::string plannedDumpPath();

}
