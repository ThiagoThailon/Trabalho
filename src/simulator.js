import {
  BASE_ARRIVAL_INTERVAL_MINUTES,
  FLAPPING_INTERVAL_SECONDS,
  MAX_STAY_MINUTES,
  MIN_STAY_MINUTES,
  PEAK_WINDOWS,
  SECTORS,
  SPOTS_PER_SECTOR,
  SIMULATION_MINUTES_PER_SECOND,
} from "./config.js";
import { randomUUID } from "node:crypto";
import { buildGatewayStatusTopic, buildSpotEventsTopic } from "./parking-topics.js";

function padSpotNumber(number) {
  return String(number).padStart(2, "0");
}

function createSeededRng(seed = 123456789) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function minuteOfDay(simulationTime) {
  return simulationTime.getHours() * 60 + simulationTime.getMinutes();
}

function peakMultiplier(simulationTime) {
  const minute = minuteOfDay(simulationTime);
  return PEAK_WINDOWS.reduce((multiplier, window) => {
    if (minute >= window.start && minute < window.end) {
      return Math.max(multiplier, window.multiplier);
    }
    return multiplier;
  }, 1);
}

function sampleStayMinutes(rng) {
  const min = Math.log(MIN_STAY_MINUTES);
  const max = Math.log(MAX_STAY_MINUTES);
  return Math.round(Math.exp(min + (max - min) * rng()));
}

function buildSpotId(sector, spotNumber) {
  return `${sector}-${padSpotNumber(spotNumber)}`;
}

function nextArrivalDelayMinutes(rng, simulationTime) {
  const multiplier = peakMultiplier(simulationTime);
  const meanInterval = BASE_ARRIVAL_INTERVAL_MINUTES / multiplier;
  const jitter = 0.55 + rng() * 0.9;
  return Math.max(1, Math.round(meanInterval * jitter));
}

function createSensor(sector, spotNumber, rng, now) {
  const id = buildSpotId(sector, spotNumber);
  return {
    id,
    sector,
    spotNumber,
    state: "FREE",
    fault: null,
    faultSetAt: null,
    flappingLastFlipAt: null,
    occupiedUntil: null,
    nextArrivalAt: new Date(now.getTime() + nextArrivalDelayMinutes(rng, now) * 60_000),
    lastChangeAt: now,
    faultExpiresAt: null,
  };
}

function createGateway(sector) {
  return {
    id: `G-${sector}`,
    sector,
    online: true,
    lastHeartbeatAt: new Date(),
  };
}

function applyFault(sensor, mode, now) {
  sensor.fault = mode;
  sensor.faultSetAt = now;
  sensor.flappingLastFlipAt = now;
}

function clearFault(sensor) {
  sensor.fault = null;
  sensor.faultSetAt = null;
  sensor.flappingLastFlipAt = null;
}

function shouldFlap(sensor, now) {
  if (!sensor.flappingLastFlipAt) {
    sensor.flappingLastFlipAt = now;
    return false;
  }

  const elapsedSeconds = (now.getTime() - sensor.flappingLastFlipAt.getTime()) / 1000;
  if (elapsedSeconds >= FLAPPING_INTERVAL_SECONDS) {
    sensor.flappingLastFlipAt = now;
    return true;
  }

  return false;
}

export function createParkingSimulation({ seed = 123456789, startTime = new Date() } = {}) {
  const rng = createSeededRng(seed);
  const sensors = new Map();
  const gateways = new Map();

  for (const sector of SECTORS) {
    gateways.set(sector, createGateway(sector));
    for (let spotNumber = 1; spotNumber <= SPOTS_PER_SECTOR; spotNumber += 1) {
      const sensor = createSensor(sector, spotNumber, rng, startTime);
      sensors.set(sensor.id, sensor);
    }
  }

  const state = {
    startedAt: startTime,
    simulatedAt: new Date(startTime),
    lastRealTickAt: Date.now(),
  };

  function step(realNow = Date.now()) {
    const elapsedRealSeconds = Math.max(0, (realNow - state.lastRealTickAt) / 1000);
    state.lastRealTickAt = realNow;
    const simulatedAdvanceMinutes = elapsedRealSeconds * SIMULATION_MINUTES_PER_SECOND;
    state.simulatedAt = new Date(state.simulatedAt.getTime() + simulatedAdvanceMinutes * 60_000);

    for (const gateway of gateways.values()) {
      gateway.lastHeartbeatAt = new Date(state.simulatedAt);
      gateway.online = true;
      notifyGatewayStatus(gateway, state.simulatedAt);
    }

    expireFaults(state.simulatedAt);

    for (const sensor of sensors.values()) {
      updateSensor(sensor, state.simulatedAt);
    }
  }

  function updateSensor(sensor, now) {
    const prevState = sensor.state;

    if (sensor.fault === "stuck_occupied") {
      sensor.state = "OCCUPIED";
      sensor.occupiedUntil = null;
      if (prevState !== sensor.state) notifySpotEvent(sensor, now);
      return;
    }

    if (sensor.fault === "stuck_free") {
      sensor.state = "FREE";
      sensor.nextArrivalAt = new Date(now.getTime() + 30 * 60_000);
      sensor.occupiedUntil = null;
      if (prevState !== sensor.state) notifySpotEvent(sensor, now);
      return;
    }

    if (sensor.fault === "flapping") {
      if (shouldFlap(sensor, now)) {
        sensor.state = sensor.state === "FREE" ? "OCCUPIED" : "FREE";
        sensor.lastChangeAt = now;
        notifySpotEvent(sensor, now);
      }
      return;
    }

    if (sensor.state === "FREE") {
      if (sensor.nextArrivalAt && now >= sensor.nextArrivalAt) {
        sensor.state = "OCCUPIED";
        sensor.lastChangeAt = now;
        sensor.occupiedUntil = new Date(now.getTime() + sampleStayMinutes(rng) * 60_000);
        notifySpotEvent(sensor, now);
      }
      return;
    }

    if (sensor.occupiedUntil && now >= sensor.occupiedUntil) {
      sensor.state = "FREE";
      sensor.lastChangeAt = now;
      sensor.nextArrivalAt = new Date(now.getTime() + nextArrivalDelayMinutes(rng, now) * 60_000);
      sensor.occupiedUntil = null;
      notifySpotEvent(sensor, now);
    }
  }

  function listSensors() {
    return Array.from(sensors.values()).map((sensor) => ({
      id: sensor.id,
      sector: sensor.sector,
      spotNumber: sensor.spotNumber,
      state: sensor.state,
      fault: sensor.fault,
      lastChangeAt: sensor.lastChangeAt,
      nextArrivalAt: sensor.nextArrivalAt,
      occupiedUntil: sensor.occupiedUntil,
    }));
  }

  function listGateways() {
    return Array.from(gateways.values()).map((gateway) => ({
      ...gateway,
    }));
  }

  function getSummary() {
    let free = 0;
    let occupied = 0;
    for (const sensor of sensors.values()) {
      if (sensor.state === "FREE") {
        free += 1;
      } else {
        occupied += 1;
      }
    }

    return {
      total: sensors.size,
      free,
      occupied,
      faults: Array.from(sensors.values()).filter((sensor) => sensor.fault).length,
    };
  }

  function setFault({ sensorId, sector, mode, durationMinutes } = {}, now = state.simulatedAt) {
    const targetSensors = [];

    if (sensorId) {
      const sensor = sensors.get(sensorId);
      if (sensor) {
        targetSensors.push(sensor);
      }
    } else if (sector) {
      for (const sensor of sensors.values()) {
        if (sensor.sector === sector) {
          targetSensors.push(sensor);
        }
      }
    } else {
      targetSensors.push(...sensors.values());
    }

    for (const sensor of targetSensors) {
      applyFault(sensor, mode, now);
      if (typeof durationMinutes === "number" && durationMinutes > 0) {
        sensor.faultExpiresAt = new Date(now.getTime() + durationMinutes * 60_000);
      } else {
        sensor.faultExpiresAt = null;
      }
    }

    return targetSensors.map((sensor) => sensor.id);
  }

  function clearFaults(filter = {}) {
    const changed = [];
    for (const sensor of sensors.values()) {
      if (filter.sensorId && sensor.id !== filter.sensorId) {
        continue;
      }
      if (filter.sector && sensor.sector !== filter.sector) {
        continue;
      }
      if (!filter.sensorId && !filter.sector && !sensor.fault) {
        continue;
      }
      clearFault(sensor);
      sensor.faultExpiresAt = null;
      changed.push(sensor.id);
    }
    return changed;
  }

  function expireFaults(now = state.simulatedAt) {
    for (const sensor of sensors.values()) {
      if (sensor.faultExpiresAt && now >= sensor.faultExpiresAt) {
        clearFault(sensor);
        sensor.faultExpiresAt = null;
      }
    }
  }

  function snapshot() {
    return {
      startedAt: state.startedAt,
      simulatedAt: state.simulatedAt,
      summary: getSummary(),
      sensors: listSensors(),
      gateways: listGateways(),
    };
  }

  function listSensorsByFilter(filter = {}) {
    return listSensors().filter((sensor) => {
      if (filter.sector && sensor.sector !== filter.sector) {
        return false;
      }

      if (filter.state && sensor.state !== filter.state) {
        return false;
      }

      if (filter.fault && sensor.fault !== filter.fault) {
        return false;
      }

      return true;
    });
  }

  // Pub/Sub: listeners notified when spot events, gateway heartbeats or manual readings are published
  const publishListeners = new Set();

  function emitEvent(event) {
    for (const cb of publishListeners) {
      try {
        cb(event);
      } catch (err) {
        // ignore listener errors
      }
    }
  }

  function notifySpotEvent(sensor, now, source = "sensor") {
    emitEvent({
      type: "spot_event",
      topic: buildSpotEventsTopic(sensor.sector, sensor.id),
      payload: {
        eventId: randomUUID(),
        ts: now.toISOString(),
        sectorId: sensor.sector,
        spotId: sensor.id,
        state: sensor.state,
        source,
      },
      simulatedAt: now,
    });
  }

  function notifyGatewayStatus(gateway, now) {
    emitEvent({
      type: "gateway_status",
      topic: buildGatewayStatusTopic(gateway.sector),
      payload: {
        eventId: randomUUID(),
        ts: now.toISOString(),
        sectorId: gateway.sector,
        gatewayId: gateway.id,
        status: gateway.online ? "ONLINE" : "OFFLINE",
        source: "gateway",
      },
      simulatedAt: now,
    });
  }

  function onPublish(cb) {
    publishListeners.add(cb);
    return () => publishListeners.delete(cb);
  }

  function publishReading(reading) {
    const now = state.simulatedAt;
    if (reading && typeof reading === "object" && reading.sectorId && reading.spotId && reading.state) {
      const event = {
        type: "spot_event",
        topic: buildSpotEventsTopic(reading.sectorId, reading.spotId),
        payload: {
          eventId: reading.eventId || randomUUID(),
          ts: reading.ts ? new Date(reading.ts).toISOString() : now.toISOString(),
          sectorId: reading.sectorId,
          spotId: reading.spotId,
          state: reading.state,
          source: reading.source || "gateway",
        },
        simulatedAt: now,
      };
      emitEvent(event);
      return event;
    }

    const payload = { type: "manual_reading", reading, simulatedAt: now };
    emitEvent(payload);
    return payload;
  }

  return {
    step,
    snapshot,
    listSensors: listSensorsByFilter,
    setFault,
    clearFaults,
    expireFaults,
    publishReading,
    onPublish,
    getSensor(sensorId) {
      return sensors.get(sensorId) || null;
    },
  };
}

export const simulatorInternals = {
  createSeededRng,
  peakMultiplier,
  sampleStayMinutes,
  buildSpotId,
  nextArrivalDelayMinutes,
};