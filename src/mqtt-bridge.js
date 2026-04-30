import { createParkingStore } from "./parking-store.js";

function parseMessage(message) {
  return JSON.parse(message.toString("utf8"));
}

export async function createParkingMqttBridge({
  simulation,
  store = createParkingStore(),
  url = process.env.MQTT_URL,
  logger = console,
} = {}) {
  if (!url || !simulation) {
    return null;
  }

  let mqttModule;
  try {
    mqttModule = await import("mqtt");
  } catch (error) {
    logger.warn(`MQTT indisponível: ${error.message}`);
    return null;
  }

  const client = mqttModule.connect(url, {
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  });

  const unsubscribe = simulation.onPublish((event) => {
    if (!event?.topic || !event?.payload) {
      return;
    }

    client.publish(event.topic, JSON.stringify(event.payload), { qos: 1 });
  });

  client.on("connect", () => {
    client.subscribe(["campus/parking/sectors/+/spots/+/events", "campus/parking/sectors/+/gateway/status"], {
      qos: 1,
    });
  });

  client.on("message", (topic, message) => {
    try {
      const payload = parseMessage(message);
      store.ingestEnvelope({ topic, payload });
    } catch (error) {
      logger.warn(`Mensagem MQTT ignorada em ${topic}: ${error.message}`);
    }
  });

  client.on("error", (error) => {
    logger.warn(`Falha no broker MQTT: ${error.message}`);
  });

  return {
    client,
    store,
    stop() {
      unsubscribe();
      client.end(true);
    },
  };
}