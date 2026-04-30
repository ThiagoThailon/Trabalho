import http from "node:http";
import { HTTP_PORT, SECTORS } from "./config.js";
import { createParkingSimulation } from "./simulator.js";
import { createParkingStore } from "./parking-store.js";
import { createParkingMqttBridge } from "./mqtt-bridge.js";

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

export function createServer({ simulation = createParkingSimulation(), store = createParkingStore() } = {}) {
  if (typeof store.bootstrapFromSnapshot === "function") {
    store.bootstrapFromSnapshot(simulation.snapshot());
  }

  function advanceSimulationAndPersist() {
    simulation.step();
    if (typeof store.persistSnapshot === "function") {
      store.persistSnapshot(simulation.snapshot());
    }
  }

  // SSE clients
  const sseClients = new Set();
  if (typeof simulation.onPublish === 'function') {
    simulation.onPublish((event) => {
      if (event?.topic && event?.payload) {
        try {
          store.ingestEnvelope({ topic: event.topic, payload: event.payload });
        } catch (error) {
          // ignore store errors so SSE keeps flowing
        }
      }

      const data = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of sseClients) {
        try {
          res.write(data);
        } catch (err) {
          // ignore
        }
      }
    });
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/layout") {
        sendJson(response, 200, {
          sectors: SECTORS,
          spotsPerSector: 30,
          layout: SECTORS.flatMap((sector) =>
            Array.from({ length: 30 }, (_, index) => `${sector}-${String(index + 1).padStart(2, "0")}`),
          ),
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/status") {
        advanceSimulationAndPersist();
        sendJson(response, 200, simulation.snapshot());
        return;
      }

      if (request.method === "GET" && url.pathname === "/events") {
        sendJson(response, 200, store.getSnapshot());
        return;
      }

      if (request.method === "GET" && url.pathname === "/sensors") {
        advanceSimulationAndPersist();
        const sector = url.searchParams.get("sector") || undefined;
        const state = url.searchParams.get("state") || undefined;
        const fault = url.searchParams.get("fault") || undefined;
        sendJson(response, 200, {
          sensors: simulation.listSensors({ sector, state, fault }),
        });
        return;
      }

      const sensorRouteMatch = url.pathname.match(/^\/sensors\/([A-C]-\d{2})$/);
      if (sensorRouteMatch && request.method === "GET") {
        const sensorId = sensorRouteMatch[1];
        advanceSimulationAndPersist();
        const sensor = simulation.getSensor(sensorId);
        if (!sensor) {
          sendJson(response, 404, { error: "sensor_not_found" });
          return;
        }

        sendJson(response, 200, { sensor });
        return;
      }

      const sensorFaultRouteMatch = url.pathname.match(/^\/sensors\/([A-C]-\d{2})\/fault$/);
      if (sensorFaultRouteMatch) {
        const sensorId = sensorFaultRouteMatch[1];

        if (request.method === "POST") {
          const body = await readJsonBody(request);
          const sensor = simulation.getSensor(sensorId);
          if (!sensor) {
            sendJson(response, 404, { error: "sensor_not_found" });
            return;
          }

          simulation.setFault({
            sensorId,
            mode: body.mode,
            durationMinutes: body.durationMinutes,
          });
          if (typeof store.persistSnapshot === "function") {
            store.persistSnapshot(simulation.snapshot());
          }
          sendJson(response, 200, { sensor: simulation.getSensor(sensorId) });
          return;
        }

        if (request.method === "DELETE") {
          const cleared = simulation.clearFaults({ sensorId });
          if (typeof store.persistSnapshot === "function") {
            store.persistSnapshot(simulation.snapshot());
          }
          sendJson(response, 200, { cleared });
          return;
        }
      }

      if (request.method === "POST" && url.pathname === "/faults") {
        const body = await readJsonBody(request);
        const affected = simulation.setFault(body);
        if (typeof store.persistSnapshot === "function") {
          store.persistSnapshot(simulation.snapshot());
        }
        sendJson(response, 200, { affected });
        return;
      }

      if (request.method === "DELETE" && url.pathname === "/faults") {
        const body = request.headers["content-length"] ? await readJsonBody(request) : {};
        const affected = simulation.clearFaults(body);
        if (typeof store.persistSnapshot === "function") {
          store.persistSnapshot(simulation.snapshot());
        }
        sendJson(response, 200, { cleared: affected });
        return;
      }

      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      sendJson(response, 400, { error: "bad_request", message: error.message });
    }
  });
}

export function startServer(port = HTTP_PORT) {
  const simulation = createParkingSimulation();
  const store = createParkingStore();
  const server = createServer({ simulation, store });

  void createParkingMqttBridge({ simulation, store }).catch((error) => {
    console.warn(`MQTT bridge não iniciado: ${error.message}`);
  });

  const timer = setInterval(() => {
    simulation.step();
    if (typeof store.persistSnapshot === "function") {
      store.persistSnapshot(simulation.snapshot());
    }
  }, 1000);

  server.on("close", () => {
    clearInterval(timer);
    if (typeof store.close === "function") {
      store.close();
    }
  });

  server.listen(port, () => {
    console.log(`Simulador disponível em http://localhost:${port}`);
  });
  return server;
}