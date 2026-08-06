import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./boot.css";

// Old CRT monitor being filmed. Green phosphor. A real Linux-style boot:
// hundreds of dmesg/systemd lines flooding by fast, a typed command, then
// the screen powers into the scene. Doubles as the loading screen.

const COMMAND = "systemctl start claude-bot.service";

// Pools we stitch a long, plausible kernel/systemd boot log out of.
const KERN = [
  "Linux version 4.8.0-cryo (root@wavelab) (gcc 14.2.0) #1 SMP PREEMPT",
  "Command line: BOOT_IMAGE=/vmlinuz-cryo root=/dev/nvme0n1p2 ro quiet",
  "x86/fpu: Supporting XSAVE feature 0x002: 'SSE registers'",
  "BIOS-provided physical RAM map:",
  "e820: BIOS-e820: [mem 0x0000000000000000-0x000000000009fbff] usable",
  "Memory: 64291612K/67108864K available (14340K kernel code)",
  "SLUB: HWalign=64, Order=0-3, MinObjects=0, CPUs=32, Nodes=1",
  "smpboot: CPU0: AMD Cryo-32 @ 4.80GHz (family: 0x19, model: 0x61)",
  "Performance Events: PEBS fmt4+, AMD PMU driver.",
  "clocksource: tsc-early: mask 0xffffffffffffffff max_cycles 0x453",
  "pci 0000:00:00.0: [1002:164e] type 00 class 0x060000",
  "nvme nvme0: pci function 0000:01:00.0",
  "nvme0n1: p1 p2 p3",
  "EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode",
  "systemd[1]: Detected architecture x86-64.",
  "systemd[1]: Set hostname to <claude-bot>.",
  "random: crng init done",
  "usb 1-3: new high-speed USB device number 2 using xhci_hcd",
  "input: cryo-sensor-array as /devices/platform/cryo/input/input4",
  "thermal thermal_zone0: registered as cooling_device0 (sleet)",
  "wlan0: authenticate with wavelab-mesh",
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
  "Reached target Claude Bot — awake",
];

// filler probe lines to fatten the flood so it reads like a real boot
const HEX = "0123456789abcdef";
const rhex = (n) => Array.from({ length: n }, () => HEX[(Math.random() * 16) | 0]).join("");
const PROBES = [
  () => `pci 0000:0${(Math.random() * 8) | 0}:00.0: [10de:${rhex(4)}] type 00 class 0x0${(Math.random() * 60000) | 0}`,
  () => `ACPI: bus type PCI registered`,
  () => `usb ${((Math.random() * 4) | 0) + 1}-${((Math.random() * 6) | 0) + 1}: new high-speed USB device number ${(Math.random() * 12) | 0}`,
  () => `scsi ${(Math.random() * 8) | 0}:0:0:0: Direct-Access CRYO SSD ${rhex(2).toUpperCase()} PQ: 0 ANSI: 6`,
  () => `EXT4-fs (nvme0n1p${((Math.random() * 3) | 0) + 1}): re-mounted. Opts: (null)`,
  () => `audit: type=1400 audit(${(Date.now() / 1000).toFixed(3)}): apparmor="STATUS"`,
  () => `cryo-gpu 0000:01:00.0: [drm] fb0: cryodrmfb frame buffer device`,
  () => `Bluetooth: hci0: cryo firmware patch completed`,
  () => `r8169 0000:03:00.0 eth0: Link is Up - 1Gbps/Full`,
  () => `systemd[1]: Starting user@100${(Math.random() * 9) | 0}.service...`,
  () => `kauditd_printk_skb: ${(Math.random() * 30) | 0} callbacks suppressed`,
  () => `mem: Initialise system trusted keyrings 0x${rhex(8)}`,
  () => `RAPL PMU: API unit is 2^-32 Joules, 3 fixed counters`,
  () => `process '/usr/bin/cryo-init' started with executable stack`,
];

// pre-build the flood: [timestamp] tag message
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
  // header
  KERN.forEach((m) => push(m, "kern"));
  // fat probe flood interleaved with service starts (no mutation of SVC)
  let s = 0;
  for (let i = 0; i < 150; i++) {
    push(PROBES[(Math.random() * PROBES.length) | 0](), "kern");
    if (i % 5 === 0 && s < SVC.length) pushSvc(SVC[s++]);
  }
  // drain any remaining services at the end
  while (s < SVC.length) pushSvc(SVC[s++]);
  push("[  OK  ] Reached target Claude Bot — awake", "ok");
  push("[  OK  ] Startup finished in 4.812s (kernel) + 1.204s (userspace).", "ok");
  return out;
}

const LOG = buildLog();
const TOTAL = LOG.length;

export default function Boot({ onDone }) {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState("typing"); // typing → flood → done
  const [n, setN] = useState(0); // how many log lines revealed
  const [leaving, setLeaving] = useState(false);
  const scrollRef = useRef(null);
  const done = useRef(false);

  // 1 ─ type the command (green)
  useEffect(() => {
    if (phase !== "typing") return;
    if (typed.length < COMMAND.length) {
      const id = setTimeout(
        () => setTyped(COMMAND.slice(0, typed.length + 1)),
        30 + Math.random() * 40
      );
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setPhase("flood"), 360);
    return () => clearTimeout(id);
  }, [typed, phase]);

  // 2 ─ flood the boot log fast, a few lines per tick
  useEffect(() => {
    if (phase !== "flood") return;
    let raf;
    let i = 0;
    const tick = () => {
      i += 2 + Math.floor(Math.random() * 2); // 2–3 lines a tick
      setN(Math.min(i, TOTAL));
      if (i >= TOTAL) {
        setTimeout(finish, 620);
        return;
      }
      raf = setTimeout(tick, 34 + Math.random() * 40);
    };
    tick();
    return () => clearTimeout(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // keep the log pinned to the bottom as it grows
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n]);

  function finish() {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    setPhase("done");
    setTimeout(() => onDone?.(), 850);
  }

  useEffect(() => {
    const onKey = () => finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`crt ${leaving ? "crt--off" : ""}`} onClick={finish}>
      <div className="crt__cam">
        <div className="crt__screen">
          <div className="crt__glass">
            <div className="crt__scroll" ref={scrollRef}>
              <pre className="crt__pre">
                {LOG.slice(0, n).map((l, i) =>
                  l ? (
                    <div className={`crt__ln crt__ln--${l.kind}`} key={i}>
                      <span className="crt__ts">[{l.t}]</span> {l.msg}
                    </div>
                  ) : null
                )}
                {phase !== "typing" && n < TOTAL && (
                  <div className="crt__ln">
                    <span className="crt__ts">[{(0).toFixed(6)}]</span>{" "}
                    <span className="crt__cur">█</span>
                  </div>
                )}
                {phase === "typing" && (
                  <div className="crt__cmd">
                    <span className="crt__user">root@claude-bot</span>
                    <span className="crt__punc">:</span>
                    <span className="crt__path">~</span>
                    <span className="crt__punc"># </span>
                    {typed}
                    <span className="crt__cur">█</span>
                  </div>
                )}
              </pre>
            </div>
          </div>
          <div className="crt__scan" />
          <div className="crt__roll" />
          <div className="crt__glow" />
          <div className="crt__hint">press any key ▸ skip</div>
        </div>
      </div>
    </div>
  );
}
