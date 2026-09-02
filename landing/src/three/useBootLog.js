import { useEffect, useRef, useState } from "react";

// Sequences a fake-but-plausible Linux boot: types a command, then floods
// ~200 dmesg/systemd lines fast. Exposes state for the 3D terminal to draw.

const COMMAND = "systemctl start claude-bot.service";
const PROMPT = "root@claude-bot:~";

const KERN = [
  "Linux version 4.8.0-cryo (root@wavelab) (gcc 14.2.0) #1 SMP PREEMPT",
  "Command line: BOOT_IMAGE=/vmlinuz-cryo root=/dev/nvme0n1p2 ro quiet",
  "x86/fpu: Supporting XSAVE feature 0x002: 'SSE registers'",
  "Memory: 64291612K/67108864K available (14340K kernel code)",
  "smpboot: CPU0: AMD Cryo-32 @ 4.80GHz (family 0x19, model 0x61)",
  "clocksource: tsc-early: mask 0xffffffffffffffff",
  "nvme nvme0: pci function 0000:01:00.0",
  "EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode",
  "systemd[1]: Detected architecture x86-64.",
  "systemd[1]: Set hostname to <claude-bot>.",
  "random: crng init done",
  "thermal thermal_zone0: registered as cooling_device0 (sleet)",
  "IPv6: ADDRCONF(NETDEV_CHANGE): wlan0: link becomes ready",
];

const SVC = [
  "Mounted /brain — persistent memory store",
  "Started rain-daemon.service",
  "Started tool-bus.socket",
  "Reached target Network is Online",
  "Starting model-router@claude.service",
  "Starting model-router@chatgpt.service",
  "Starting model-router@gemini.service",
  "Starting model-router@deepseek.service",
  "Starting model-router@qwen.service",
  "Starting model-router@mistral.service",
  "Starting model-router@grok.service",
  "Starting model-router@glm.service",
  "Starting model-router@kimi.service",
  "Starting model-router@perplexity.service",
  "Starting model-router@minimax.service",
  "Starting model-router@meta.service",
  "Starting model-router@mimo.service",
  "Fusing 13 routers into single core",
  "Started emotion-subsystem.service",
  "Started vision.service",
  "Started voice.service",
  "Started weather.service (sleet, 1C)",
  "Started mail.service",
  "Started youtube.service",
  "Started notes.service",
  "Started calendar.service",
  "Loaded persona: owner",
];

const HEX = "0123456789abcdef";
const rhex = (n) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");
const PROBES = [
  () => `pci 0000:0${(Math.random() * 8) | 0}:00.0: [10de:${rhex(4)}] type 00 class 0x0${(Math.random() * 60000) | 0}`,
  () => `usb ${((Math.random() * 4) | 0) + 1}-${((Math.random() * 6) | 0) + 1}: new high-speed USB device number ${(Math.random() * 12) | 0}`,
  () => `scsi ${(Math.random() * 8) | 0}:0:0:0: Direct-Access CRYO SSD ${rhex(2).toUpperCase()} PQ 0 ANSI 6`,
  () => `audit: type=1400 audit(${(Date.now() / 1000).toFixed(3)}): apparmor="STATUS"`,
  () => `cryo-gpu 0000:01:00.0: [drm] fb0: cryodrmfb frame buffer device`,
  () => `r8169 0000:03:00.0 eth0: Link is Up - 1Gbps/Full`,
  () => `systemd[1]: Starting user@100${(Math.random() * 9) | 0}.service...`,
  () => `kauditd_printk_skb: ${(Math.random() * 30) | 0} callbacks suppressed`,
  () => `RAPL PMU: API unit is 2^-32 Joules, 3 fixed counters`,
  () => `process '/usr/bin/cryo-init' started with executable stack`,
];

function buildLog() {
  const out = [];
  let t = 0;
  const push = (msg, kind = "kern") => {
    t += 0.0006 + Math.random() * 0.03;
    out.push({ t: t.toFixed(6), msg, kind });
  };
  const pushSvc = (m) => {
    const ok = !/^Starting|Fusing/.test(m);
    push(`[  ${ok ? "OK" : "  "}  ] ${m}`, ok ? "ok" : "svc");
  };
  KERN.forEach((m) => push(m, "kern"));
  let s = 0;
  for (let i = 0; i < 150; i++) {
    push(PROBES[(Math.random() * PROBES.length) | 0](), "kern");
    if (i % 5 === 0 && s < SVC.length) pushSvc(SVC[s++]);
  }
  while (s < SVC.length) pushSvc(SVC[s++]);
  push("[  OK  ] Reached target Claude Bot — awake", "ok");
  push("[  OK  ] Startup finished in 4.812s (kernel) + 1.204s (userspace).", "ok");
  return out;
}

export function useBootLog(onDone) {
  const [phase, setPhase] = useState("typing"); // typing → flood → done
  const [typed, setTyped] = useState("");
  const [n, setN] = useState(0);
  const logRef = useRef(buildLog());
  const done = useRef(false);
  const TOTAL = logRef.current.length;

  // Skip the whole cold-boot: any key, or ?skipIntro in the URL. Worth
  // having on its own (nobody wants the intro twice), and it's the escape
  // hatch when a background tab throttles the log's timers to a crawl.
  useEffect(() => {
    const skip = () => {
      setTyped(COMMAND);
      setN(TOTAL);
      setPhase("done");
      finish();
    };
    if (new URLSearchParams(window.location.search).has("skipIntro")) {
      skip();
      return undefined;
    }
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1 ─ type the command
  useEffect(() => {
    if (phase !== "typing") return;
    if (typed.length < COMMAND.length) {
      const id = setTimeout(
        () => setTyped(COMMAND.slice(0, typed.length + 1)),
        8 + Math.random() * 12
      );
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPhase("flood"), 120);
    return () => clearTimeout(id);
  }, [typed, phase]);

  // 2 ─ flood the log
  useEffect(() => {
    if (phase !== "flood") return;
    let timer;
    let i = 0;
    const tick = () => {
      i += 4 + Math.floor(Math.random() * 4);
      setN(Math.min(i, TOTAL));
      if (i >= TOTAL) {
        timer = setTimeout(() => finish(), 280);
        return;
      }
      timer = setTimeout(tick, 16 + Math.random() * 18);
    };
    tick();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function finish() {
    if (done.current) return;
    done.current = true;
    setPhase("done");
    onDone?.();
  }

  return {
    phase,
    typed,
    command: COMMAND,
    prompt: PROMPT,
    lines: logRef.current.slice(0, n),
    progress: phase === "typing" ? 0 : Math.min(1, n / TOTAL),
  };
}
