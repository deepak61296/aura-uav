import fs from "fs";
import path from "path";
import { spawn } from "child_process";

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

const LOG_DIR = "/tmp/aura-sim";
const SITL_LOG = path.join(LOG_DIR, "sitl.log");
const CONTROLLER_LOG = path.join(LOG_DIR, "controller.log");

let sitlProcess = null;
let controllerProcess = null;
let lastHome = null;

const ensureLogDir = () => {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync("/tmp/aura-sitl", { recursive: true });
};

const toOffsetLongitude = (lat, lng, offsetMeters) =>
  lng - offsetMeters / (111320 * Math.cos((lat * Math.PI) / 180));

const appendLogHandle = (filePath) => fs.openSync(filePath, "a");

const processStatus = (child) => ({
  running: Boolean(child && child.exitCode === null && !child.killed),
  pid: child?.pid ?? null,
});

const cleanupProcessRef = (name) => {
  if (name === "sitl") sitlProcess = null;
  if (name === "controller") controllerProcess = null;
};

const attachExitCleanup = (name, child) => {
  child.on("exit", () => cleanupProcessRef(name));
  child.on("error", () => cleanupProcessRef(name));
};

const stopChild = async (child, signal = "SIGTERM") => {
  if (!child || child.exitCode !== null || child.killed) return;

  child.kill(signal);

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 3000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

export const stopSimStack = async () => {
  await stopChild(controllerProcess);
  await stopChild(sitlProcess);
  controllerProcess = null;
  sitlProcess = null;
};

export const getSimStatus = () => ({
  sitl: processStatus(sitlProcess),
  controller: processStatus(controllerProcess),
  home: lastHome,
  logs: {
    sitl: SITL_LOG,
    controller: CONTROLLER_LOG,
  },
});

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

  return getSimStatus();
};
