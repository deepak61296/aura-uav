import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const SITL_BIN = process.env.SITL_BIN || "/home/deepak/ardupilot/build/sitl/bin/arducopter";
const SITL_DEFAULTS =
  process.env.SITL_DEFAULTS || "/home/deepak/ardupilot/Tools/autotest/default_params/copter.parm";
const SITL_OFFSET_METERS = Number(process.env.AURA_SITL_OFFSET_METERS || 150);
const SITL_ALT = Number(process.env.AURA_SITL_ALT || 243.95);
const SITL_HEADING = Number(process.env.AURA_SITL_HEADING || 90);
const SITL_UDP_TARGET = process.env.AURA_SITL_UDP_TARGET || "127.0.0.1:14550";
const CONTROLLER_PORT = Number(process.env.CONTROLLER_PORT || 5001);
const API_BASE_URL = process.env.AURA_API_BASE_URL || "http://localhost:5000";
const API_KEY = process.env.API_KEY || "SUPER_SECRET_KEY";
const DRONE_ID = process.env.AURA_DRONE_ID || "DRONE001";
const CONTROLLER_PATTERN = path.join(REPO_ROOT, "Python", "finalcode.py");

const LOG_DIR = "/tmp/aura-sim";
const SITL_LOG = path.join(LOG_DIR, "sitl.log");
const CONTROLLER_LOG = path.join(LOG_DIR, "controller.log");
const SITL_PID_FILE = path.join(LOG_DIR, "sitl.pid");
const CONTROLLER_PID_FILE = path.join(LOG_DIR, "controller.pid");

let sitlProcess = null;
let controllerProcess = null;
let lastHome = null;

const ensureLogDir = () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync("/tmp/aura-sitl", { recursive: true });
};

const resetLogFile = (filePath) => {
  fs.writeFileSync(filePath, "");
};

const readPidFile = (filePath) => {
  try {
    const pid = Number(fs.readFileSync(filePath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};

const writePidFile = (filePath, pid) => {
  fs.writeFileSync(filePath, String(pid));
};

const removePidFile = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch {}
};

const isPidRunning = (pid) => {
  if (!pid) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const execFileAsync = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, (error, stdout) => {
    if (error) {
      resolve([]);
      return;
    }

    const pids = stdout
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

    resolve(pids);
  });
});

const findMatchingPids = async (pattern) => execFileAsync("pgrep", ["-f", pattern]);

const newestPid = async (pattern) => {
  const pids = await findMatchingPids(pattern);
  return pids.length ? pids[pids.length - 1] : null;
};

const toOffsetLongitude = (lat, lng, offsetMeters) =>
  lng - offsetMeters / (111320 * Math.cos((lat * Math.PI) / 180));

const appendLogHandle = (filePath) => fs.openSync(filePath, "a");

const processStatus = (child, pidFile) => {
  const childRunning = Boolean(child && child.exitCode === null && !child.killed);
  const pid = child?.pid ?? readPidFile(pidFile);

  return {
    running: childRunning || isPidRunning(pid),
    pid: pid ?? null,
  };
};

const controllerStatus = () => processStatus(controllerProcess, CONTROLLER_PID_FILE);

const cleanupProcessRef = (name) => {
  if (name === "sitl") {
    sitlProcess = null;
    removePidFile(SITL_PID_FILE);
  }
  if (name === "controller") {
    controllerProcess = null;
    removePidFile(CONTROLLER_PID_FILE);
  }
};

const attachExitCleanup = (name, child) => {
  child.on("exit", () => cleanupProcessRef(name));
  child.on("error", () => cleanupProcessRef(name));
};

const stopByPid = async (pid) => {
  if (!isPidRunning(pid)) return;

  process.kill(pid, "SIGTERM");

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (isPidRunning(pid)) {
    process.kill(pid, "SIGKILL");
  }
};

const stopChild = async (child, pidFile) => {
  const pid = child?.pid ?? readPidFile(pidFile);
  await stopByPid(pid);
};

const stopMatchingProcesses = async (pattern) => {
  const pids = await findMatchingPids(pattern);
  await Promise.all(pids.map((pid) => stopByPid(pid)));
};

export const stopSimStack = async () => {
  await stopChild(controllerProcess, CONTROLLER_PID_FILE);
  await stopChild(sitlProcess, SITL_PID_FILE);
  await stopMatchingProcesses(CONTROLLER_PATTERN);
  await stopMatchingProcesses(SITL_BIN);
  controllerProcess = null;
  sitlProcess = null;
  removePidFile(CONTROLLER_PID_FILE);
  removePidFile(SITL_PID_FILE);
};

const controllerBaseStatus = () => ({
  sitl: processStatus(sitlProcess, SITL_PID_FILE),
  controller: processStatus(controllerProcess, CONTROLLER_PID_FILE),
  home: lastHome,
  logs: {
    sitl: SITL_LOG,
    controller: CONTROLLER_LOG,
  },
});

const fetchControllerTelemetry = async () => {
  if (!controllerStatus().running && !(await newestPid(CONTROLLER_PATTERN))) {
    return null;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${CONTROLLER_PORT}/telemetry`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

const hasGpsFix = (telemetry) =>
  Boolean(
    telemetry
      && telemetry.gpsFixType >= 3
      && telemetry.gps?.latitude
      && telemetry.gps?.longitude
  );

const getStartedAt = () => {
  try {
    return fs.statSync(SITL_LOG).mtime.toISOString();
  } catch {
    return null;
  }
};

export const getSimStatus = async () => {
  const telemetry = await fetchControllerTelemetry();
  const base = controllerBaseStatus();
  const startedAt = getStartedAt();
  const startedMs = startedAt ? Date.parse(startedAt) : null;
  const warmupSeconds = startedMs ? Math.max(0, Math.round((Date.now() - startedMs) / 1000)) : null;
  const inferredRunning = Boolean(telemetry);

  return {
    ...base,
    sitl: {
      ...base.sitl,
      running: base.sitl.running || inferredRunning,
      pid: base.sitl.pid ?? await newestPid(SITL_BIN),
    },
    controller: {
      ...base.controller,
      running: base.controller.running || inferredRunning,
      pid: base.controller.pid ?? await newestPid(CONTROLLER_PATTERN),
    },
    controllerReady: Boolean(telemetry),
    gpsReady: hasGpsFix(telemetry),
    startedAt,
    warmupSeconds,
    warmupTimedOut: Boolean(telemetry && !hasGpsFix(telemetry) && warmupSeconds != null && warmupSeconds > 30),
    telemetry,
  };
};

const waitForControllerReady = async (timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const telemetry = await fetchControllerTelemetry();
    if (telemetry) {
      return telemetry;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return null;
};

export const startSimStack = async ({ lat, lng, alt, heading, offsetMeters, droneId } = {}) => {
  ensureLogDir();
  await stopSimStack();

  const homeLat = Number(lat);
  const homeLng = toOffsetLongitude(homeLat, Number(lng), Number(offsetMeters ?? SITL_OFFSET_METERS));
  const homeAlt = Number(alt ?? SITL_ALT);
  const homeHeading = Number(heading ?? SITL_HEADING);

  lastHome = {
    lat: homeLat,
    lng: homeLng,
    alt: homeAlt,
    heading: homeHeading,
    targetLat: Number(lat),
    targetLng: Number(lng),
  };

  resetLogFile(SITL_LOG);
  resetLogFile(CONTROLLER_LOG);

  const sitlLogHandle = appendLogHandle(SITL_LOG);
  sitlProcess = spawn(
    SITL_BIN,
    [
      "-w",
      "--model", "+",
      "--speedup", "1",
      "--slave", "0",
      "--defaults", SITL_DEFAULTS,
      "--sim-address=127.0.0.1",
      "--home", `${homeLat},${homeLng},${homeAlt},${homeHeading}`,
      "--serial0", `udpclient:${SITL_UDP_TARGET}`,
    ],
    {
      cwd: "/tmp/aura-sitl",
      stdio: ["ignore", sitlLogHandle, sitlLogHandle],
    }
  );
  attachExitCleanup("sitl", sitlProcess);
  writePidFile(SITL_PID_FILE, sitlProcess.pid);

  await new Promise((resolve) => setTimeout(resolve, 4000));

  const controllerLogHandle = appendLogHandle(CONTROLLER_LOG);
  controllerProcess = spawn(
    "python3",
    [path.join(REPO_ROOT, "Python", "finalcode.py")],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DRONE_ID: droneId || DRONE_ID,
        API_BASE_URL,
        VEHICLE_CONNECTION: "udp:127.0.0.1:14550",
        API_KEY,
        CONTROLLER_PORT: String(CONTROLLER_PORT),
      },
      stdio: ["ignore", controllerLogHandle, controllerLogHandle],
    }
  );
  attachExitCleanup("controller", controllerProcess);
  writePidFile(CONTROLLER_PID_FILE, controllerProcess.pid);

  const telemetry = await waitForControllerReady();

  return {
    ...controllerBaseStatus(),
    controllerReady: Boolean(telemetry),
    gpsReady: hasGpsFix(telemetry),
    startedAt: getStartedAt(),
    warmupSeconds: 0,
    warmupTimedOut: false,
    telemetry,
  };
};
