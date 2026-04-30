import {
  isGatewayStatusTopic,
  isSpotEventsTopic,
} from "./parking-topics.js";
import { createParkingDatabase } from "./parking-database.js";
import crypto from "node:crypto";

function toIsoString(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
}

function normalizeSpotEvent(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("spot_event_payload_invalid");
  }

  const { eventId, ts, sectorId, spotId, state, source } = payload;
  if (!eventId || !ts || !sectorId || !spotId || !state || !source) {
    throw new Error("spot_event_payload_missing_fields");
  }

  return {
    eventId,
    ts: toIsoString(ts),
    sectorId,
    spotId,
    state,
    source,
  };
}

function normalizeGatewayStatus(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("gateway_status_payload_invalid");
  }

  const { eventId, ts, sectorId, gatewayId, status, source } = payload;
  if (!eventId || !ts || !sectorId || !gatewayId || !status || !source) {
    throw new Error("gateway_status_payload_missing_fields");
  }

  return {
    eventId,
    ts: toIsoString(ts),
    sectorId,
    gatewayId,
    status,
    source,
  };
}

function getSeverityForFault(fault) {
  if (fault === "flapping") {
    return "HIGH";
  }

  if (fault === "stuck_occupied") {
    return "MEDIUM";
  }

  if (fault === "stuck_free") {
    return "LOW";
  }

  return "LOW";
}

function toMinuteIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return `${iso.slice(0, 16)}:00.000Z`;
}

export function createParkingStore({ database = createParkingDatabase() } = {}) {
  const events = [];
  const spotStates = new Map();
  const gatewayStates = new Map();

  for (const row of database.listSpots()) {
    spotStates.set(row.spotId, {
      spotId: row.spotId,
      sectorId: row.sectorId,
      state: row.currentState,
      lastChangeTs: row.lastChangeTs,
      lastEventId: row.lastEventId,
      updatedAt: row.lastChangeTs,
    });
  }

  for (const row of database.listSpotEvents()) {
    events.push({
      kind: "spot_event",
      topic: `campus/parking/sectors/${row.sectorId}/spots/${row.spotId}/events`,
      payload: JSON.parse(row.rawPayloadJson),
      receivedAt: new Date(row.ts),
    });
  }

  function recordEvent(record) {
    events.push(record);
    return record;
  }

  function getEventById(eventId) {
    return events.find((event) => event.payload.eventId === eventId) || null;
  }

  function persistSpotState(normalized) {
    database.upsertSpot({
      spotId: normalized.spotId,
      sectorId: normalized.sectorId,
      currentState: normalized.state,
      lastChangeTs: normalized.ts,
      lastEventId: normalized.eventId,
    });

    spotStates.set(normalized.spotId, {
      spotId: normalized.spotId,
      sectorId: normalized.sectorId,
      state: normalized.state,
      lastChangeTs: normalized.ts,
      lastEventId: normalized.eventId,
      updatedAt: new Date().toISOString(),
    });
  }

  function ingestSpotEvent(payload, meta = {}) {
    const normalized = normalizeSpotEvent(payload);
    const stored = database.insertSpotEvent({
      ...normalized,
      rawPayloadJson: JSON.stringify(payload),
    });
    if (!stored) {
      return { duplicated: true, event: getEventById(normalized.eventId) };
    }

    const record = recordEvent({
      kind: "spot_event",
      topic: meta.topic,
      payload: normalized,
      receivedAt: new Date(),
    });
    persistSpotState(normalized);

    return { duplicated: false, event: record };
  }

  function ingestGatewayStatus(payload, meta = {}) {
    const normalized = normalizeGatewayStatus(payload);
    if (getEventById(normalized.eventId)) {
      return { duplicated: true, event: getEventById(normalized.eventId) };
    }

    const record = recordEvent({
      kind: "gateway_status",
      topic: meta.topic,
      payload: normalized,
      receivedAt: new Date(),
    });

    gatewayStates.set(normalized.sectorId, {
      eventId: normalized.eventId,
      sectorId: normalized.sectorId,
      gatewayId: normalized.gatewayId,
      status: normalized.status,
      source: normalized.source,
      ts: normalized.ts,
      updatedAt: record.receivedAt.toISOString(),
    });

    return { duplicated: false, event: record };
  }

  function ingestEnvelope(envelope) {
    const topic = envelope?.topic;
    const payload = envelope?.payload;

    if (typeof topic !== "string") {
      throw new Error("mqtt_topic_invalid");
    }

    if (isSpotEventsTopic(topic)) {
      return ingestSpotEvent(payload, { topic });
    }

    if (isGatewayStatusTopic(topic)) {
      return ingestGatewayStatus(payload, { topic });
    }

    throw new Error("mqtt_topic_unrecognized");
  }

  function listEvents() {
    return events.map((event) => ({
      ...event,
      payload: { ...event.payload },
    }));
  }

  function getSpotState(spotId) {
    return spotStates.get(spotId) || null;
  }

  function getGatewayState(sectorId) {
    return gatewayStates.get(sectorId) || null;
  }

  function getSnapshot() {
    return {
      events: listEvents(),
      spots: Array.from(spotStates.values()),
      gateways: Array.from(gatewayStates.values()),
      incidents: database.listIncidents(),
      recommendations: database.listRecommendations(),
      snapshots: database.listSectorSnapshots(),
    };
  }

  function persistSnapshot(snapshot) {
    const simulatedAt = snapshot?.simulatedAt || new Date();
    const sectorStats = new Map();

    for (const sensor of snapshot?.sensors || []) {
      const currentState = sensor.state;
      const sectorId = sensor.sector;
      const lastChangeTs = sensor.lastChangeAt instanceof Date ? sensor.lastChangeAt.toISOString() : sensor.lastChangeAt || null;

      database.upsertSpot({
        spotId: sensor.id,
        sectorId,
        currentState,
        lastChangeTs,
        lastEventId: spotStates.get(sensor.id)?.lastEventId || null,
      });

      spotStates.set(sensor.id, {
        spotId: sensor.id,
        sectorId,
        state: currentState,
        lastChangeTs,
        lastEventId: spotStates.get(sensor.id)?.lastEventId || null,
        updatedAt: toMinuteIso(simulatedAt),
      });

      if (!sectorStats.has(sectorId)) {
        sectorStats.set(sectorId, { occupied: 0, free: 0 });
      }

      sectorStats.get(sectorId)[currentState === "OCCUPIED" ? "occupied" : "free"] += 1;
    }

    for (const [sectorId, counts] of sectorStats.entries()) {
      database.upsertSectorSnapshot({
        ts: simulatedAt,
        sectorId,
        occupiedCount: counts.occupied,
        freeCount: counts.free,
        occupancyRate: (counts.occupied / Math.max(1, counts.occupied + counts.free)),
      });
    }

    for (const sensor of snapshot?.sensors || []) {
      if (!sensor.fault) {
        const openIncident = database.findOpenIncidentBySpot(sensor.id);
        if (openIncident) {
          database.closeIncident(openIncident.id, simulatedAt instanceof Date ? simulatedAt.toISOString() : new Date(simulatedAt).toISOString());
        }
        continue;
      }

      const openIncident = database.findOpenIncidentBySpot(sensor.id);
      if (!openIncident) {
        database.insertIncident({
          id: crypto.randomUUID(),
          tsOpen: simulatedAt instanceof Date ? simulatedAt.toISOString() : new Date(simulatedAt).toISOString(),
          tsClose: null,
          type: "sensor_fault",
          severity: getSeverityForFault(sensor.fault),
          sectorId: sensor.sector,
          spotId: sensor.id,
          evidenceJson: JSON.stringify({
            fault: sensor.fault,
            lastChangeAt: sensor.lastChangeAt,
            sensor,
          }),
          status: "OPEN",
        });
      }
    }

    const sortedSectors = Array.from(sectorStats.entries())
      .map(([sectorId, counts]) => ({
        sectorId,
        occupiedCount: counts.occupied,
        freeCount: counts.free,
        occupancyRate: counts.occupied / Math.max(1, counts.occupied + counts.free),
      }))
      .sort((left, right) => right.occupancyRate - left.occupancyRate);

    if (sortedSectors.length >= 2) {
      const mostOccupied = sortedSectors[0];
      const leastOccupied = sortedSectors[sortedSectors.length - 1];
      if (mostOccupied.occupancyRate - leastOccupied.occupancyRate >= 0.15) {
        database.insertRecommendation({
          ts: toMinuteIso(simulatedAt),
          fromSector: mostOccupied.sectorId,
          recommendedSector: leastOccupied.sectorId,
          reason: "balancear_ocupacao",
          dataJson: JSON.stringify({
            sectors: sortedSectors,
            simulatedAt: simulatedAt instanceof Date ? simulatedAt.toISOString() : new Date(simulatedAt).toISOString(),
          }),
        });
      }
    }
  }

  function bootstrapFromSnapshot(snapshot) {
    persistSnapshot(snapshot);
  }

  return {
    close: () => database.close(),
    ingestSpotEvent,
    ingestGatewayStatus,
    ingestEnvelope,
    listEvents,
    getEventById,
    getSpotState,
    getGatewayState,
    getSnapshot,
    persistSnapshot,
    bootstrapFromSnapshot,
  };
}