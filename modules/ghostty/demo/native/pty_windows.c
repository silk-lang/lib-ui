// A pseudoconsole (ConPTY, Windows 10 1809 and later) and its child process, with the same
// contract as pty_unix.c: reads never block, writes queue, sizes propagate. Error codes are
// Win32 error codes or HRESULTs.
#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#ifndef NTDDI_VERSION
#define NTDDI_VERSION 0x0A000006
#endif
#include <windows.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    HPCON console;
    HANDLE input;   // Our end of the console's input: keys go here.
    HANDLE output;  // Our end of the console's output: the screen comes from here.
    HANDLE process;
    int eof;
    int32_t status;
    uint8_t *pending;
    size_t start, length, capacity;
} SilkPty;

static void reap(SilkPty *p) {
    if (!p->process || p->status >= 0) return;
    DWORD code = 0;
    if (WaitForSingleObject(p->process, 0) == WAIT_OBJECT_0 && GetExitCodeProcess(p->process, &code)) {
        p->status = (int32_t)(code & 0x7fffffff);
    }
}

void silk_term_pty_free(SilkPty *p) {
    if (!p) return;
    if (p->process) {
        reap(p);
        if (p->status < 0) TerminateProcess(p->process, 1);
        CloseHandle(p->process);
    }
    // Closing our ends first keeps ClosePseudoConsole from waiting on an unread pipe.
    if (p->output) CloseHandle(p->output);
    if (p->input) CloseHandle(p->input);
    if (p->console) ClosePseudoConsole(p->console);
    free(p->pending);
    free(p);
}

// command == NULL starts %COMSPEC% (cmd.exe); otherwise `cmd.exe /c command`.
int32_t silk_term_pty_new(uint16_t cols, uint16_t rows, const uint8_t *command,
                          size_t command_length, SilkPty **out) {
    *out = NULL;
    if (!cols || !rows || command_length > 30000) return ERROR_INVALID_PARAMETER;
    SilkPty *p = calloc(1, sizeof(*p));
    if (!p) return ERROR_NOT_ENOUGH_MEMORY;
    p->status = -1;
    int32_t error = 0;
    HANDLE inputRead = NULL, outputWrite = NULL;
    LPPROC_THREAD_ATTRIBUTE_LIST attributes = NULL;
    WCHAR *line = NULL;
    if (!CreatePipe(&inputRead, &p->input, NULL, 0) || !CreatePipe(&p->output, &outputWrite, NULL, 0)) {
        error = (int32_t)GetLastError();
        goto done;
    }
    COORD size = {(SHORT)cols, (SHORT)rows};
    HRESULT result = CreatePseudoConsole(size, inputRead, outputWrite, 0, &p->console);
    if (FAILED(result)) { error = (int32_t)result; p->console = NULL; goto done; }

    // The command line: the shell, then `/c` and the command when there is one.
    WCHAR shell[MAX_PATH];
    DWORD shellLength = GetEnvironmentVariableW(L"COMSPEC", shell, MAX_PATH);
    if (shellLength == 0 || shellLength >= MAX_PATH) {
        static const WCHAR fallback[] = L"C:\\Windows\\System32\\cmd.exe";
        memcpy(shell, fallback, sizeof fallback);
        shellLength = (DWORD)(sizeof fallback / sizeof fallback[0] - 1);
    }
    int wide = 0;
    if (command_length) {
        wide = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)command,
                                   (int)command_length, NULL, 0);
        if (wide <= 0) { error = (int32_t)GetLastError(); goto done; }
    }
    size_t capacity = shellLength + 6 + (size_t)wide + 1;
    line = calloc(capacity, sizeof(WCHAR));
    if (!line) { error = ERROR_NOT_ENOUGH_MEMORY; goto done; }
    line[0] = L'"';
    memcpy(line + 1, shell, shellLength * sizeof(WCHAR));
    line[shellLength + 1] = L'"';
    size_t at = shellLength + 2;
    if (command_length) {
        memcpy(line + at, L" /c ", 4 * sizeof(WCHAR));
        at += 4;
        MultiByteToWideChar(CP_UTF8, 0, (const char *)command, (int)command_length, line + at, wide);
        at += (size_t)wide;
    }
    line[at] = 0;

    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(NULL, 1, 0, &bytes);
    attributes = malloc(bytes);
    if (!attributes) { error = ERROR_NOT_ENOUGH_MEMORY; goto done; }
    if (!InitializeProcThreadAttributeList(attributes, 1, 0, &bytes)
        || !UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                                      p->console, sizeof(p->console), NULL, NULL)) {
        error = (int32_t)GetLastError();
        free(attributes);
        attributes = NULL;
        goto done;
    }
    STARTUPINFOEXW startup;
    memset(&startup, 0, sizeof(startup));
    startup.StartupInfo.cb = sizeof(startup);
    // No standard handles of ours: the child's come from the pseudoconsole.
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.lpAttributeList = attributes;
    PROCESS_INFORMATION process;
    memset(&process, 0, sizeof(process));
    if (!CreateProcessW(NULL, line, NULL, NULL, FALSE, EXTENDED_STARTUPINFO_PRESENT, NULL, NULL,
                        &startup.StartupInfo, &process)) {
        error = (int32_t)GetLastError();
        goto done;
    }
    CloseHandle(process.hThread);
    p->process = process.hProcess;
done:
    // The console holds its own references to these ends.
    if (inputRead) CloseHandle(inputRead);
    if (outputWrite) CloseHandle(outputWrite);
    if (attributes) { DeleteProcThreadAttributeList(attributes); free(attributes); }
    free(line);
    if (error) { silk_term_pty_free(p); return error; }
    *out = p;
    return 0;
}

static int32_t flush(SilkPty *p) {
    while (p->length) {
        DWORD written = 0;
        DWORD chunk = p->length > 65536 ? 65536 : (DWORD)p->length;
        if (!WriteFile(p->input, p->pending + p->start, chunk, &written, NULL)) {
            return (int32_t)GetLastError();
        }
        p->start += written;
        p->length -= written;
    }
    p->start = 0;
    return 0;
}

int32_t silk_term_pty_write(SilkPty *p, const uint8_t *bytes, size_t length) {
    reap(p);
    if (p->eof || p->status >= 0) return ERROR_BROKEN_PIPE;
    if (length > 8388608 - p->length) return ERROR_NOT_ENOUGH_MEMORY;
    if (p->start) { memmove(p->pending, p->pending + p->start, p->length); p->start = 0; }
    if (p->length + length > p->capacity) {
        size_t capacity = p->length + length;
        uint8_t *buffer = realloc(p->pending, capacity);
        if (!buffer) return ERROR_NOT_ENOUGH_MEMORY;
        p->pending = buffer;
        p->capacity = capacity;
    }
    if (length) memcpy(p->pending + p->length, bytes, length);
    p->length += length;
    return flush(p);
}

int32_t silk_term_pty_read(SilkPty *p, uint8_t *bytes, size_t capacity, size_t *written) {
    *written = 0;
    if (!capacity) return ERROR_INVALID_PARAMETER;
    reap(p);
    if (p->eof) return 0;
    DWORD available = 0;
    if (!PeekNamedPipe(p->output, NULL, 0, NULL, &available, NULL)) {
        DWORD error = GetLastError();
        if (error == ERROR_BROKEN_PIPE) { p->eof = 1; return 0; }
        return (int32_t)error;
    }
    if (available == 0) {
        // The console keeps its output open after the child exits: an exited child with
        // nothing left to read is the end.
        if (p->status >= 0) p->eof = 1;
        return 0;
    }
    DWORD want = available < capacity ? available : (capacity > 0x7fffffff ? 0x7fffffff : (DWORD)capacity);
    DWORD count = 0;
    if (!ReadFile(p->output, bytes, want, &count, NULL)) {
        DWORD error = GetLastError();
        if (error == ERROR_BROKEN_PIPE) { p->eof = 1; return 0; }
        return (int32_t)error;
    }
    *written = count;
    return 0;
}

int32_t silk_term_pty_resize(SilkPty *p, uint16_t cols, uint16_t rows) {
    if (!cols || !rows) return ERROR_INVALID_PARAMETER;
    COORD size = {(SHORT)cols, (SHORT)rows};
    HRESULT result = ResizePseudoConsole(p->console, size);
    return FAILED(result) ? (int32_t)result : 0;
}

int32_t silk_term_pty_status(SilkPty *p) { reap(p); return p->status; }

uint8_t silk_term_pty_finished(const SilkPty *p) { return p->eof && p->status >= 0; }
