import assert from "node:assert/strict";
import test from "node:test";
import { buildGatewayStatusTopic, buildSpotEventsTopic } from "../src/parking-topics.js";
import { createParkingDatabase } from "../src/parking-database.js";
import { createParkingStore } from "../src/parking-store.js";
import { createPublisher } from "../src/publisher.js";

test("monta os tópicos obrigatórios de MQTT", () => {
  assert.equal(buildSpotEventsTopic("A", "A-07"), "campus/parking/sectors/A/spots/A-07/events");
  assert.equal(buildGatewayStatusTopic("A"), "campus/parking/sectors/A/gateway/status");
});

test("ignora eventos duplicados pelo eventId e atualiza estado atual", () => {
  const database = createParkingDatabase({ databasePath: ":memory:" });
  const store = createParkingStore({ database });
  const payload = {
    eventId: "11111111-1111-1111-1111-111111111111",
    ts: "2026-04-29T10:15:30.000Z",
    sectorId: "A",
    spotId: "A-07",
    state: "OCCUPIED",
    source: "sensor",
  };

  const first = store.ingestSpotEvent(payload, { topic: buildSpotEventsTopic("A", "A-07") });
  const second = store.ingestSpotEvent(payload, { topic: buildSpotEventsTopic("A", "A-07") });

  assert.equal(first.duplicated, false);
  assert.equal(second.duplicated, true);
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.getSpotState("A-07").state, "OCCUPIED");
  assert.equal(database.listSpots().length, 1);
});

test("registra gateway status por setor", () => {
  const database = createParkingDatabase({ databasePath: ":memory:" });
  const store = createParkingStore({ database });
  store.ingestGatewayStatus(
    {
      eventId: "22222222-2222-2222-2222-222222222222",
      ts: "2026-04-29T10:15:30.000Z",
      sectorId: "A",
      gatewayId: "G-A",
      status: "ONLINE",
      source: "gateway",
    },
    { topic: buildGatewayStatusTopic("A") },
  );

  assert.equal(store.getGatewayState("A").status, "ONLINE");
});

test("persiste snapshot, incidentes e recomendações", () => {
  const database = createParkingDatabase({ databasePath: ":memory:" });
  const store = createParkingStore({ database });

  store.persistSnapshot({
    simulatedAt: new Date("2026-04-29T10:15:30.000Z"),
    sensors: [
      { id: "A-01", sector: "A", state: "OCCUPIED", fault: "stuck_occupied", lastChangeAt: new Date("2026-04-29T10:00:00.000Z") },
      { id: "A-02", sector: "A", state: "FREE", fault: null, lastChangeAt: new Date("2026-04-29T10:01:00.000Z") },
      { id: "B-01", sector: "B", state: "FREE", fault: null, lastChangeAt: new Date("2026-04-29T10:01:00.000Z") },
      { id: "B-02", sector: "B", state: "FREE", fault: null, lastChangeAt: new Date("2026-04-29T10:01:00.000Z") },
    ],
  });

  assert.equal(database.listSectorSnapshots().length, 2);
  assert.equal(database.listIncidents().length, 1);
  assert.ok(database.listRecommendations().length >= 1);
  assert.equal(database.listSpots().find((spot) => spot.spotId === "A-01").currentState, "OCCUPIED");
});

test("publisher persiste dados ao iniciar e parar", () => {
  const database = createParkingDatabase({ databasePath: ":memory:" });
  const store = createParkingStore({ database });
  const publisher = createPublisher({ store, startTime: new Date("2026-04-29T08:00:00.000Z") });

  publisher.start();
  publisher.stop();

  assert.ok(database.listSpots().length > 0);
  assert.ok(database.listSectorSnapshots().length > 0);
});