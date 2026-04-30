import { createPublisher } from "./publisher.js";

/**
 * Subscriber: Recebe eventos do Publisher
 * Pode ser usado como um cliente independente que ouve eventos de sensores
 */

export function createSubscriber(publisherInstance) {
  const events = [];
  let maxEventsInMemory = 1000;
  let onEventCallback = null;

  function onEvent(callback) {
    if (typeof callback !== "function") {
      throw new Error("Callback deve ser uma função");
    }
    onEventCallback = callback;
  }

  const unsubscribe = publisherInstance.subscribe((event) => {
    // Manter histórico de eventos (últimos 1000)
    events.push({
      ...event,
      receivedAt: new Date(),
    });

    if (events.length > maxEventsInMemory) {
      events.shift();
    }

    // Chamar callback se registrado
    if (onEventCallback) {
      try {
        onEventCallback(event);
      } catch (err) {
        console.error("Erro ao processar evento:", err.message);
      }
    }
  });

  function getEventHistory() {
    return [...events];
  }

  function getLastEventBySensor(sensorId) {
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.type === "spot_event" && event.payload?.spotId === sensorId) {
        return event;
      }
      if (event.type === "sensor_update" && event.sensor.id === sensorId) {
        return event;
      }
    }
    return null;
  }

  function getEventsBySector(sector) {
    return events.filter(
      (event) =>
        (event.type === "spot_event" && event.payload?.sectorId === sector) ||
        (event.type === "sensor_update" && event.sensor.sector === sector),
    );
  }

  function getEventsSinceTime(timeMs) {
    return events.filter((event) => {
      const eventTime = event.receivedAt?.getTime() || 0;
      return eventTime >= Date.now() - timeMs;
    });
  }

  function unsubscribeFromPublisher() {
    unsubscribe();
  }

  return {
    onEvent,
    getEventHistory,
    getLastEventBySensor,
    getEventsBySector,
    getEventsSinceTime,
    unsubscribe: unsubscribeFromPublisher,
    getStats: () => ({
      totalEventsReceived: events.length,
      oldestEvent: events[0]?.receivedAt,
      newestEvent: events[events.length - 1]?.receivedAt,
    }),
  };
}

// Se executado diretamente
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🔔 Iniciando Subscriber...\n");

  const publisher = createPublisher();
  const subscriber = createSubscriber(publisher);

  // Variáveis para rastrear estatísticas
  let updateCount = 0;
  let openedDuringSession = 0;
  let closedDuringSession = 0;
  const sensorStates = new Map();

  // Configurar callback para processar eventos
  subscriber.onEvent((event) => {
    if (event.type === "initial_state") {
      const { snapshot } = event;
      console.log("📍 Garagem Iniciada:");
      console.log(`   Setores: ${snapshot.gateways.map((g) => g.id).join(", ")}`);
      console.log(
        `   Vagas: ${snapshot.summary.total} (${snapshot.summary.free} livres, ${snapshot.summary.occupied} ocupadas)`,
      );
      console.log("━".repeat(80));
      console.log("");
    } else if (event.type === "spot_event") {
      const { payload } = event;
      const previousState = sensorStates.get(payload.spotId);

      if (!previousState) {
        sensorStates.set(payload.spotId, payload.state);
      }

      if (payload.state !== previousState) {
        updateCount++;
        const time = new Date(event.simulatedAt).toLocaleTimeString("pt-BR");
        const emoji = payload.state === "OCCUPIED" ? "🔴" : "🟢";

        console.log(`[${time}] ${emoji} ${payload.spotId}: ${payload.state}`);

        if (payload.state === "OCCUPIED") {
          openedDuringSession++;
        } else {
          closedDuringSession++;
        }

        sensorStates.set(payload.spotId, payload.state);
      }
    } else if (event.type === "gateway_status") {
      const time = new Date(event.simulatedAt).toLocaleTimeString("pt-BR");
      console.log(`[${time}] ⚙️ gateway ${event.payload.sectorId}: ${event.payload.status}`);
    } else if (event.type === "sensor_update") {
      const { sensor } = event;
      const previousState = sensorStates.get(sensor.id);

      if (!previousState) {
        sensorStates.set(sensor.id, sensor.state);
      }

      if (sensor.state !== previousState) {
        updateCount++;
        const time = new Date(event.simulatedAt).toLocaleTimeString("pt-BR");
        const emoji = sensor.state === "OCCUPIED" ? "🔴" : "🟢";

        console.log(`[${time}] ${emoji} ${sensor.id}: ${sensor.state}`);

        if (sensor.state === "OCCUPIED") {
          openedDuringSession++;
        } else {
          closedDuringSession++;
        }

        sensorStates.set(sensor.id, sensor.state);
      }
    }
  });

  console.log("⏳ Aguardando eventos...\n");
  publisher.start();

  // Exibir estatísticas a cada 30 segundos
  const statsInterval = setInterval(() => {
    const stats = subscriber.getStats();
    const totalOccupied = sensorStates.size > 0
      ? Array.from(sensorStates.values()).filter((s) => s === "OCCUPIED").length
      : 0;

    console.log("");
    console.log("📊 Estatísticas (últimos 30s):");
    console.log(`   Eventos processados: ${updateCount}`);
    console.log(`   Vagas ocupadas neste ciclo: ${openedDuringSession}`);
    console.log(`   Vagas liberadas neste ciclo: ${closedDuringSession}`);
    console.log(`   Total de vagas ocupadas agora: ${totalOccupied}/90`);
    console.log(`   Total de eventos recebidos: ${stats.totalEventsReceived}`);
    console.log("");

    updateCount = 0;
    openedDuringSession = 0;
    closedDuringSession = 0;
  }, 30000);

  // Tratamento de sinais de parada
  process.on("SIGINT", () => {
    console.log("\n");
    console.log("━".repeat(80));
    clearInterval(statsInterval);
    subscriber.unsubscribe();
    publisher.stop();
    console.log("👋 Subscriber finalizado");
    process.exit(0);
  });
}
