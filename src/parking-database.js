import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

function normalizeDatabasePath(databasePath) {
  if (!databasePath || databasePath === ":memory:") {
    return ":memory:";
  }

  return path.isAbsolute(databasePath) ? databasePath : path.resolve(databasePath);
}

function ensureParentDirectory(filePath) {
  if (filePath === ":memory:") {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function toMinuteIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  return `${iso.slice(0, 16)}:00.000Z`;
}

export function createParkingDatabase({ databasePath = process.env.PARKING_DB_PATH || "data/parking.sqlite" } = {}) {
  const resolvedPath = normalizeDatabasePath(databasePath);
  ensureParentDirectory(resolvedPath);

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS spots (
      spotId TEXT PRIMARY KEY,
      sectorId TEXT NOT NULL,
      currentState TEXT NOT NULL,
      lastChangeTs TEXT,
      lastEventId TEXT
    );

    CREATE TABLE IF NOT EXISTS spot_events (
      eventId TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      sectorId TEXT NOT NULL,
      spotId TEXT NOT NULL,
      state TEXT NOT NULL,
      rawPayloadJson TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sector_snapshots (
      ts TEXT NOT NULL,
      sectorId TEXT NOT NULL,
      occupiedCount INTEGER NOT NULL,
      freeCount INTEGER NOT NULL,
      occupancyRate REAL NOT NULL,
      PRIMARY KEY (ts, sectorId)
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      tsOpen TEXT NOT NULL,
      tsClose TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      sectorId TEXT NOT NULL,
      spotId TEXT,
      evidenceJson TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendations_log (
      ts TEXT NOT NULL,
      fromSector TEXT NOT NULL,
      recommendedSector TEXT NOT NULL,
      reason TEXT NOT NULL,
      dataJson TEXT NOT NULL,
      PRIMARY KEY (ts, fromSector, recommendedSector)
    );
  `);

  const statements = {
    upsertSpot: db.prepare(`
      INSERT INTO spots (spotId, sectorId, currentState, lastChangeTs, lastEventId)
      VALUES (@spotId, @sectorId, @currentState, @lastChangeTs, @lastEventId)
      ON CONFLICT(spotId) DO UPDATE SET
        sectorId = excluded.sectorId,
        currentState = excluded.currentState,
        lastChangeTs = excluded.lastChangeTs,
        lastEventId = excluded.lastEventId
    `),
    insertSpotEvent: db.prepare(`
      INSERT INTO spot_events (eventId, ts, sectorId, spotId, state, rawPayloadJson)
      VALUES (@eventId, @ts, @sectorId, @spotId, @state, @rawPayloadJson)
      ON CONFLICT(eventId) DO NOTHING
    `),
    upsertSectorSnapshot: db.prepare(`
      INSERT INTO sector_snapshots (ts, sectorId, occupiedCount, freeCount, occupancyRate)
      VALUES (@ts, @sectorId, @occupiedCount, @freeCount, @occupancyRate)
      ON CONFLICT(ts, sectorId) DO UPDATE SET
        occupiedCount = excluded.occupiedCount,
        freeCount = excluded.freeCount,
        occupancyRate = excluded.occupancyRate
    `),
    insertIncident: db.prepare(`
      INSERT INTO incidents (id, tsOpen, tsClose, type, severity, sectorId, spotId, evidenceJson, status)
      VALUES (@id, @tsOpen, @tsClose, @type, @severity, @sectorId, @spotId, @evidenceJson, @status)
      ON CONFLICT(id) DO NOTHING
    `),
    updateIncidentClose: db.prepare(`
      UPDATE incidents
      SET tsClose = @tsClose, status = 'CLOSED'
      WHERE id = @id AND status = 'OPEN'
    `),
    findOpenIncidentBySpot: db.prepare(`
      SELECT *
      FROM incidents
      WHERE status = 'OPEN' AND spotId = @spotId
      ORDER BY tsOpen DESC
      LIMIT 1
    `),
    listOpenIncidents: db.prepare(`
      SELECT *
      FROM incidents
      WHERE status = 'OPEN'
    `),
    insertRecommendation: db.prepare(`
      INSERT INTO recommendations_log (ts, fromSector, recommendedSector, reason, dataJson)
      VALUES (@ts, @fromSector, @recommendedSector, @reason, @dataJson)
      ON CONFLICT(ts, fromSector, recommendedSector) DO UPDATE SET
        reason = excluded.reason,
        dataJson = excluded.dataJson
    `),
    listSpots: db.prepare(`SELECT * FROM spots`),
    listSpotEvents: db.prepare(`SELECT * FROM spot_events ORDER BY rowid ASC`),
    listSectorSnapshots: db.prepare(`SELECT * FROM sector_snapshots ORDER BY ts ASC, sectorId ASC`),
    listIncidents: db.prepare(`SELECT * FROM incidents ORDER BY tsOpen ASC`),
    listRecommendations: db.prepare(`SELECT * FROM recommendations_log ORDER BY ts ASC`),
  };

  function close() {
    db.close();
  }

  function upsertSpot(spot) {
    statements.upsertSpot.run(spot);
  }

  function insertSpotEvent(event) {
    const result = statements.insertSpotEvent.run(event);
    return result.changes > 0;
  }

  function upsertSectorSnapshot(snapshot) {
    statements.upsertSectorSnapshot.run({
      ...snapshot,
      ts: toMinuteIso(snapshot.ts),
    });
  }

  function insertIncident(incident) {
    statements.insertIncident.run({
      id: incident.id || crypto.randomUUID(),
      tsOpen: incident.tsOpen,
      tsClose: incident.tsClose || null,
      type: incident.type,
      severity: incident.severity,
      sectorId: incident.sectorId,
      spotId: incident.spotId || null,
      evidenceJson: incident.evidenceJson,
      status: incident.status,
    });
  }

  function closeIncident(id, tsClose) {
    statements.updateIncidentClose.run({ id, tsClose });
  }

  function findOpenIncidentBySpot(spotId) {
    return statements.findOpenIncidentBySpot.get({ spotId }) || null;
  }

  function listOpenIncidents() {
    return statements.listOpenIncidents.all();
  }

  function insertRecommendation(recommendation) {
    statements.insertRecommendation.run(recommendation);
  }

  function listSpots() {
    return statements.listSpots.all();
  }

  function listSpotEvents() {
    return statements.listSpotEvents.all();
  }

  function listSectorSnapshots() {
    return statements.listSectorSnapshots.all();
  }

  function listIncidents() {
    return statements.listIncidents.all();
  }

  function listRecommendations() {
    return statements.listRecommendations.all();
  }

  return {
    path: resolvedPath,
    close,
    upsertSpot,
    insertSpotEvent,
    upsertSectorSnapshot,
    insertIncident,
    closeIncident,
    findOpenIncidentBySpot,
    listOpenIncidents,
    insertRecommendation,
    listSpots,
    listSpotEvents,
    listSectorSnapshots,
    listIncidents,
    listRecommendations,
  };
}