import { createParkingSimulation } from "./simulator.js";
import { SIMULATION_MINUTES_PER_SECOND } from "./config.js";
import { createParkingStore } from "./parking-store.js";

/**
 * Publisher: Simula sensores e publica eventos de mudanças
 * Roda continuamente atualizando a simulação e notificando assinantes
 */

export function createPublisher({ seed = 123456789, startTime = new Date(), store = null } = {}) {
  const simulation = createParkingSimulation({ seed, startTime });
  const subscribers = new Set();
  let simulationRunning = false;
  let simulationInterval = null;

  function persistSnapshot() {
    if (store && typeof store.persistSnapshot === "function") {
      store.persistSnapshot(simulation.snapshot());
    }
  }

  function advanceSimulation() {
    simulation.step();
    persistSnapshot();
  }

  // Registrar callback do onPublish da simulação
  simulation.onPublish((event) => {
    if (store && typeof store.ingestEnvelope === "function" && event?.topic && event?.payload) {
      try {
        store.ingestEnvelope({ topic: event.topic, payload: event.payload });
      } catch (error) {
        console.warn("Falha ao persistir evento:", error.message);
      }
    }

    // Notificar todos os subscribers
    for (const callback of subscribers) {
      try {
        callback(event);
      } catch (err) {
        console.error("Erro ao notificar subscriber:", err.message);
      }
    }
  });

  function subscribe(callback) {
    if (typeof callback !== "function") {
      throw new Error("Subscriber deve ser uma função");
    }
    subscribers.add(callback);

    // Retornar função para se desinscrever
    return () => {
      subscribers.delete(callback);
    };
  }

  function start() {
    if (simulationRunning) {
      console.warn("Publisher já está rodando");
      return;
    }

    simulationRunning = true;
    persistSnapshot();
    console.log(
      `🚀 Publisher iniciado com ${SIMULATION_MINUTES_PER_SECOND}x de velocidade de simulação`,
    );
    console.log(`   Total de sensores: ${simulation.listSensors().length}`);
    console.log(`   Gateways: ${simulation.snapshot().gateways.length}`);

    // Atualizar simulação a cada segundo
    simulationInterval = setInterval(() => {
      advanceSimulation();
    }, 1000);

    // Publicar snapshot inicial
    const initialSnapshot = {
      type: "initial_state",
      snapshot: simulation.snapshot(),
      timestamp: new Date(),
    };

    for (const callback of subscribers) {
      try {
        callback(initialSnapshot);
      } catch (err) {
        console.error("Erro ao notificar subscriber do estado inicial:", err.message);
      }
    }
  }

  function stop() {
    if (!simulationRunning) {
      return;
    }

    simulationRunning = false;
    clearInterval(simulationInterval);
    persistSnapshot();
    console.log("⛔ Publisher parado");
  }

  function getSnapshot() {
    advanceSimulation();
    return simulation.snapshot();
  }

  function applyFault(faultConfig) {
    const result = simulation.setFault(faultConfig);
    persistSnapshot();
    return result;
  }

  function clearFaults(filter = {}) {
    const result = simulation.clearFaults(filter);
    persistSnapshot();
    return result;
  }

  return {
    subscribe,
    start,
    stop,
    getSnapshot,
    applyFault,
    clearFaults,
    isRunning: () => simulationRunning,
  };
}

// Se executado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const publisher = createPublisher({ store: createParkingStore() });

  // Subscriber simples para exibir eventos no console
  publisher.subscribe((event) => {
    if (event.type === "spot_event") {
      const { payload } = event;
      console.log(
        `[${new Date(event.simulatedAt).toLocaleTimeString("pt-BR")}] ${payload.spotId}: ${payload.state}`,
      );
    } else if (event.type === "gateway_status") {
      console.log(
        `[${new Date(event.simulatedAt).toLocaleTimeString("pt-BR")}] gateway ${event.payload.sectorId}: ${event.payload.status}`,
      );
    } else if (event.type === "sensor_update") {
      const { sensor } = event;
      console.log(
        `[${new Date(event.simulatedAt).toLocaleTimeString("pt-BR")}] ${sensor.id}: ${sensor.state}`,
      );
    } else if (event.type === "initial_state") {
      const { summary } = event.snapshot;
      console.log(`\n📊 Estado Inicial da Garagem:`);
      console.log(`   Total: ${summary.total} | Livres: ${summary.free} | Ocupadas: ${summary.occupied}`);
      console.log("");
    }
  });

  publisher.start();

  // Tratamiento de sinais de parada
  process.on("SIGINT", () => {
    console.log("\n");
    publisher.stop();
    process.exit(0);
  });
}
