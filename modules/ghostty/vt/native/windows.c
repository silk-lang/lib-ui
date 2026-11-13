// Built only on Windows, by scripts/prepare, into ghostty-bridge.lib.
//
// The release's Windows library is built for windows-gnu and carries Zig's compiler_rt, whose
// weak fmod and fmodf collide with Silk's own. prepare takes compiler_rt out of the archive;
// the C library supplies everything else the library needs from it except MinGW's stack probe,
// which is MSVC's __chkstk under another name (both probe RAX bytes below RSP and change no
// register).

#if defined(_WIN32) && defined(__x86_64__)
__asm__(
    ".text\n"
    ".globl ___chkstk_ms\n"
    "___chkstk_ms:\n"
    "  jmp __chkstk\n");
#elif defined(_WIN32) && defined(__aarch64__)
__asm__(
    ".text\n"
    ".globl __chkstk_ms\n"
    "__chkstk_ms:\n"
    "  b __chkstk\n");
#else
typedef int ghostty_windows_only;
#endif
