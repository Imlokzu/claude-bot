//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestStopTreeKillsDescendantsItOwns(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	log, err := os.CreateTemp(t.TempDir(), "log")
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	// The grandchild outlives nothing on its own; only the group kill reaches it.
	proc, err := defaultSpawn([]string{"sh", "-c", "sleep 30 & echo $! > " + pidFile + "; wait"}, "", nil, log)
	if err != nil {
		t.Fatal(err)
	}
	var child int
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if data, err := os.ReadFile(pidFile); err == nil && strings.TrimSpace(string(data)) != "" {
			child, _ = strconv.Atoi(strings.TrimSpace(string(data)))
			break
		}
	}
	if child == 0 {
		t.Fatal("grandchild never started")
	}
	if err := stopTree(proc); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		if errors.Is(syscall.Kill(child, 0), syscall.ESRCH) {
			return
		}
	}
	t.Fatalf("grandchild %d survived", child)
}

func TestStopTreeEscalatesWhenTermIsIgnored(t *testing.T) {
	var signals []syscall.Signal
	swap(t, &killGroup, func(_ int, sig syscall.Signal) error {
		signals = append(signals, sig)
		return nil
	})
	proc := fakeLaunched(false)
	go func() {
		time.Sleep(3500 * time.Millisecond) // exits only after SIGKILL
		close(proc.done)
	}()
	if err := stopTree(proc); err != nil {
		t.Fatal(err)
	}
	if len(signals) != 2 || signals[0] != syscall.SIGTERM || signals[1] != syscall.SIGKILL {
		t.Fatalf("got %v", signals)
	}
}

func TestStopTreeStillSweepsGroupAfterLeaderExits(t *testing.T) {
	var signals []syscall.Signal
	swap(t, &killGroup, func(_ int, sig syscall.Signal) error {
		signals = append(signals, sig)
		return nil
	})
	if err := stopTree(fakeLaunched(true)); err != nil {
		t.Fatal(err)
	}
	if len(signals) != 2 || signals[1] != syscall.SIGKILL {
		t.Fatalf("descendants of an exited leader must still get SIGKILL, got %v", signals)
	}
}
