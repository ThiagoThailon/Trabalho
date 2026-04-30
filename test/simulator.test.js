import assert from "node:assert/strict";
import test from "node:test";
import { createParkingSimulation, simulatorInternals } from "../src/simulator.js";

test("gera 90 sensores e 3 gateways", () => {
  const simulation = createParkingSimulation({ seed: 1, startTime: new Date("2026-04-29T08:00:00.000Z") });
  const snapshot = simulation.snapshot();

  assert.equal(snapshot.sensors.length, 90);
  assert.equal(snapshot.gateways.length, 3);
  assert.equal(snapshot.summary.total, 90);
});

test("usa janelas de pico para elevar o ritmo de chegada", () => {
  const offPeak = simulatorInternals.peakMultiplier(new Date("2026-04-29T13:00:00.000Z"));
  const morningPeak = simulatorInternals.peakMultiplier(new Date("2026-04-29T08:00:00.000Z"));

  assert.equal(offPeak, 1);
  assert.ok(morningPeak > offPeak);
});

test("injeta e remove falha stuck_occupied", () => {
  const simulation = createParkingSimulation({ seed: 2, startTime: new Date("2026-04-29T08:00:00.000Z") });
  const [sensorId] = simulation.setFault({ sensorId: "A-01", mode: "stuck_occupied" });

  assert.equal(sensorId, "A-01");
  assert.equal(simulation.getSensor("A-01").fault, "stuck_occupied");

  simulation.clearFaults({ sensorId: "A-01" });
  assert.equal(simulation.getSensor("A-01").fault, null);
});

test("filtra sensores por setor, estado e falha", () => {
  const simulation = createParkingSimulation({ seed: 3, startTime: new Date("2026-04-29T08:00:00.000Z") });

  simulation.setFault({ sensorId: "B-02", mode: "stuck_free" });

  const sectorSensors = simulation.listSensors({ sector: "B" });
  const faultySensors = simulation.listSensors({ fault: "stuck_free" });

  assert.equal(sectorSensors.length, 30);
  assert.equal(faultySensors.length, 1);
  assert.equal(faultySensors[0].id, "B-02");
});