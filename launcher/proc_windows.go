//go:build windows

package main

import (
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

const (
	detachedProcess       = 0x00000008
	createNoWindow        = 0x08000000
	errorSharingViolation = syscall.Errno(32)
)

func detachedAttrs() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | detachedProcess}
}

var runTaskkill = func(pid int) error {
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow}
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case <-done:
		// taskkill fails harmlessly when the tree already exited.
		return nil
	case <-time.After(5 * time.Second):
		_ = cmd.Process.Kill()
		return errors.New("taskkill timed out")
	}
}

// stopTree stops only this launch's process tree. npm's .cmd shim can own a
// separate node.exe child, so terminating only the shim would leave that child
// listening after a failed startup; taskkill /T walks the tree.
func stopTree(proc *launched) error {
	if proc.exited() {
		return nil
	}
	killErr := runTaskkill(proc.pid)
	if !proc.wait(3 * time.Second) {
		_ = proc.process.Kill()
		if !proc.wait(3 * time.Second) {
			return fmt.Errorf("process %d did not exit", proc.pid)
		}
	}
	return killErr
}

// acquireLock opens the lock file with no sharing. Windows refuses a second
// handle while the first is open and closes it when the launcher dies, which
// gives the same crash-safe behaviour as flock without extra dependencies.
func acquireLock(path string) (func(), error) {
	name, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	handle, err := syscall.CreateFile(name, syscall.GENERIC_READ|syscall.GENERIC_WRITE, 0, nil,
		syscall.OPEN_ALWAYS, syscall.FILE_ATTRIBUTE_NORMAL, 0)
	if errors.Is(err, errorSharingViolation) {
		return nil, errors.New(t("busy"))
	}
	if err != nil {
		return nil, err
	}
	return func() { _ = syscall.CloseHandle(handle) }, nil
}
