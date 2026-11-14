// A nonblocking PTY and its child on Linux and macOS. Only async-signal-safe work runs after fork.
#define _DEFAULT_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <pwd.h>
#include <signal.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>
#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif
extern char **environ;

typedef struct {
    int fd, eof, status;
    pid_t pid;
    uint8_t *pending;
    size_t start, length, capacity;
} SilkPty;

static void reap(SilkPty *p) {
    if (p->pid <= 0) return;
    int status;
    pid_t result = waitpid(p->pid, &status, WNOHANG);
    if (result == p->pid) {
        p->status = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        p->pid = 0;
    }
}

void silk_term_pty_free(SilkPty *p) {
    if (!p) return;
    // The slave's foreground group may be a job rather than the shell's group.
    if (p->fd >= 0) {
        pid_t foreground = tcgetpgrp(p->fd);
        if (foreground > 0 && foreground != getpgrp()) kill(-foreground, SIGHUP);
        close(p->fd);
    }
    if (p->pid > 0) {
        kill(-p->pid, SIGHUP);
        kill(p->pid, SIGHUP);
        for (int i = 0; i < 10 && p->pid > 0; ++i) {
            reap(p);
            if (p->pid > 0) { struct timespec delay = {0, 10000000}; nanosleep(&delay, NULL); }
        }
        if (p->pid > 0) {
            kill(-p->pid, SIGKILL);
            kill(p->pid, SIGKILL);
            while (waitpid(p->pid, NULL, 0) < 0 && errno == EINTR) {}
        }
    }
    free(p->pending);
    free(p);
}

// command == NULL launches the user's interactive shell. Tests can launch /bin/sh -c command.
int32_t silk_term_pty_new(uint16_t cols, uint16_t rows, const uint8_t *command,
                         size_t command_length, SilkPty **out) {
    *out = NULL;
    if (!cols || !rows || (command_length && memchr(command, 0, command_length))) return EINVAL;
    SilkPty *p = calloc(1, sizeof(*p));
    if (!p) return ENOMEM;
    p->fd = -1; p->status = -1;
    const char *shell = command ? "/bin/sh" : getenv("SHELL");
    if (!shell || shell[0] != '/') {
        struct passwd *pw = getpwuid(getuid());
        shell = pw && pw->pw_shell && pw->pw_shell[0] == '/' ? pw->pw_shell : "/bin/sh";
    }
    char *program = strdup(shell);
    char *script = command ? malloc(command_length + 1) : NULL;
    size_t count = 0;
    while (environ[count]) ++count;
    char **environment = calloc(count + 4, sizeof(char *));
    if (!program || (command && !script) || !environment) {
        free(program); free(script); free(environment); free(p); return ENOMEM;
    }
    if (command) { memcpy(script, command, command_length); script[command_length] = 0; }
    size_t n = 0;
    for (size_t i = 0; i < count; ++i) {
        if (strncmp(environ[i], "TERM=", 5) && strncmp(environ[i], "COLORTERM=", 10)
            && strncmp(environ[i], "TERM_PROGRAM=", 13)) environment[n++] = environ[i];
    }
    environment[n++] = "TERM=xterm-256color";
    environment[n++] = "COLORTERM=truecolor";
    environment[n++] = "TERM_PROGRAM=silk-terminal";
    int slave = -1, error_pipe[2] = {-1, -1}, error = 0;
    struct winsize size = {.ws_col=cols, .ws_row=rows};
    if (openpty(&p->fd, &slave, NULL, NULL, &size) < 0 || pipe(error_pipe) < 0) { error=errno; goto done; }
    if (fcntl(error_pipe[1], F_SETFD, FD_CLOEXEC) < 0 || fcntl(p->fd, F_SETFD, FD_CLOEXEC) < 0) {
        error=errno; goto done;
    }
    // Bound descriptor closing by the actual descriptor table, calculated in the parent.
    int maximum = getdtablesize();
    char *argv[] = {program, command ? "-c" : "-i", script, NULL};
    p->pid = fork();
    if (p->pid < 0) { p->pid=0; error=errno; goto done; }
    if (p->pid == 0) {
        close(error_pipe[0]);
        if (setsid() < 0 || ioctl(slave, TIOCSCTTY, 0) < 0
            || dup2(slave, STDIN_FILENO) < 0 || dup2(slave, STDOUT_FILENO) < 0
            || dup2(slave, STDERR_FILENO) < 0) goto child_failed;
        for (int fd=3; fd<maximum; ++fd) if (fd != error_pipe[1]) close(fd);
        struct sigaction action = {0};
        action.sa_handler = SIG_DFL;
        sigemptyset(&action.sa_mask);
        for (int sig=1; sig<NSIG; ++sig) if (sig != SIGKILL && sig != SIGSTOP) sigaction(sig, &action, NULL);
        sigset_t mask;
        sigemptyset(&mask);
        sigprocmask(SIG_SETMASK, &mask, NULL);
        execve(program, argv, environment);
child_failed:
        error = errno;
        // A small errno record fits atomically in the pipe; exec closes it on success.
        while (write(error_pipe[1], &error, sizeof(error)) < 0 && errno == EINTR) {}
        _exit(127);
    }
    close(slave); slave=-1;
    close(error_pipe[1]); error_pipe[1]=-1;
    ssize_t received;
    do { received = read(error_pipe[0], &error, sizeof(error)); } while (received < 0 && errno == EINTR);
    if (received < 0) error=errno;
    if (error) goto done;
    if (fcntl(p->fd, F_SETFL, O_NONBLOCK) < 0) { error=errno; goto done; }
    *out=p; p=NULL;
done:
    if (slave >= 0) close(slave);
    if (error_pipe[0] >= 0) close(error_pipe[0]);
    if (error_pipe[1] >= 0) close(error_pipe[1]);
    free(program); free(script); free(environment);
    silk_term_pty_free(p);
    return error;
}

static int flush(SilkPty *p) {
    while (p->length) {
        ssize_t n = write(p->fd, p->pending+p->start, p->length);
        if (n > 0) { p->start += n; p->length -= n; continue; }
        if (n < 0 && errno == EINTR) continue;
        if (n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
        return n < 0 ? errno : EIO;
    }
    p->start=0;
    return 0;
}

int32_t silk_term_pty_write(SilkPty *p, const uint8_t *bytes, size_t length) {
    if (p->eof || p->status >= 0) return EPIPE;
    if (length > 8388608-p->length) return ENOBUFS;
    if (p->start) { memmove(p->pending,p->pending+p->start,p->length); p->start=0; }
    if (p->length+length > p->capacity) {
        size_t capacity=p->length+length;
        uint8_t *buffer=realloc(p->pending,capacity);
        if (!buffer) return ENOMEM;
        p->pending=buffer; p->capacity=capacity;
    }
    if (length) memcpy(p->pending+p->length,bytes,length);
    p->length+=length;
    return flush(p);
}

int32_t silk_term_pty_read(SilkPty *p, uint8_t *bytes, size_t capacity, size_t *written) {
    *written=0;
    if (!capacity) return EINVAL;
    reap(p);
    if (p->eof) return 0;
    int error = flush(p);
    if (error && error != EIO && error != EPIPE) return error;
    ssize_t count;
    do { count=read(p->fd,bytes,capacity); } while (count<0 && errno==EINTR);
    if (count>0) { *written=(size_t)count; return 0; }
    if (count==0 || (count<0 && errno==EIO)) { p->eof=1; return 0; }
    return errno==EAGAIN || errno==EWOULDBLOCK ? 0 : errno;
}

int32_t silk_term_pty_resize(SilkPty *p, uint16_t cols, uint16_t rows) {
    if (!cols || !rows) return EINVAL;
    struct winsize size = {.ws_col=cols,.ws_row=rows};
    return ioctl(p->fd,TIOCSWINSZ,&size)<0 ? errno : 0;
}
int32_t silk_term_pty_status(SilkPty *p) { reap(p); return p->status; }

uint8_t silk_term_pty_finished(const SilkPty *p) { return p->eof && p->status >= 0; }
