//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"time"
)

// Setsid makes the spawned PID the ID of a fresh process group, so the whole
// tree this launch owns can be signalled at once and outlives the launcher.
func detachedAttrs() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}

var killGroup = func(pgid int, sig syscall.Signal) error {
	return syscall.Kill(-pgid, sig)
}

// stopTree stops only this launch's process group, never a process found by port.
func stopTree(proc *launched) error {
	if err := killGroup(proc.pid, syscall.SIGTERM); errors.Is(err, syscall.ESRCH) {
		proc.wait(3 * time.Second)
		return nil
	}
	proc.wait(3 * time.Second)
	// Reaping the group leader does not prove its descendants have exited.
	_ = killGroup(proc.pid, syscall.SIGKILL)
	if !proc.wait(3 * time.Second) {
		return fmt.Errorf("process %d did not exit after SIGKILL", proc.pid)
	}
	return nil
}

func acquireLock(path string) (func(), error) {
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}
	// flock locks expire with the launcher, including after a crash.
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New(t("busy"))
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		file.Close()
	}, nil
}
