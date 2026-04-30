import { createPublisher } from "./publisher.js";
import { createSubscriber } from "./subscriber.js";

/**
 * Test Script: Valida os tempos de permanência da simulação
 * Mostra detalhes sobre quanto tempo cada vaga fica ocupada
 */

console.log("🧪 Iniciando teste de tempos de permanência...\n");

const publisher = createPublisher();
const subscriber = createSubscriber(publisher);

const sensorOccupiedAt = new Map();
const stayDurations = [];
let transitionCount = 0;

subscriber.onEvent((event) => {
  if (event.type === "spot_event") {
    const { payload } = event;
    const simulatedTime = new Date(event.simulatedAt);

    if (payload.state === "OCCUPIED") {
      sensorOccupiedAt.set(payload.spotId, simulatedTime);
    } else if (payload.state === "FREE") {
      const occupiedAt = sensorOccupiedAt.get(payload.spotId);
      if (occupiedAt) {
        const durationMin = (simulatedTime - occupiedAt) / (1000 * 60);
        stayDurations.push(durationMin);
        sensorOccupiedAt.delete(payload.spotId);

        transitionCount++;
        if (transitionCount % 5 === 0) {
          const avg = (
            stayDurations.reduce((a, b) => a + b, 0) / stayDurations.length
          ).toFixed(1);
          const min = Math.min(...stayDurations).toFixed(1);
          const max = Math.max(...stayDurations).toFixed(1);
          console.log(
            `[${simulatedTime.toLocaleTimeString("pt-BR")}] Transições: ${transitionCount} | Permanência Média: ${avg}min | Min: ${min}min | Max: ${max}min`,
          );
        }
      }
    }
  } else if (event.type === "initial_state") {
    console.log("✅ Simulação iniciada\n");
  }
});

console.log("⏳ Coletando dados durante 60 segundos reais (~10h simuladas)...\n");
publisher.start();

setTimeout(() => {
  publisher.stop();

  if (stayDurations.length > 0) {
    const avgDuration = stayDurations.reduce((a, b) => a + b, 0) / stayDurations.length;
    const minDuration = Math.min(...stayDurations);
    const maxDuration = Math.max(...stayDurations);
    const medianDuration = stayDurations.sort((a, b) => a - b)[
      Math.floor(stayDurations.length / 2)
    ];

    console.log("\n📊 Resultados do Teste:");
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total de transições (ocupação → liberação): ${stayDurations.length}`);
    console.log(
      `Tempo de permanência MÍNIMO: ${minDuration.toFixed(2)} minutos simulados`,
    );
    console.log(
      `Tempo de permanência MÁXIMO: ${maxDuration.toFixed(2)} minutos simulados`,
    );
    console.log(`Tempo de permanência MÉDIO: ${avgDuration.toFixed(2)} minutos simulados`);
    console.log(
      `Tempo de permanência MEDIANO: ${medianDuration.toFixed(2)} minutos simulados`,
    );
    console.log(
      `Intervalo esperado: 30 a 361 minutos (30min a 6h, com margem operacional) simulados ✓`,
    );
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const withinRange = stayDurations.every(
      (d) => d >= 30 && d <= 361,
    );
    const status = withinRange ? "✅ PASSOU" : "❌ FALHOU";

    console.log(
      `\n${status}: Tempo de permanência dentro do intervalo esperado (30-361 min)?`,
    );

    if (!withinRange) {
      const outOfRange = stayDurations.filter(
        (d) => d < 30 || d > 361,
      );
      console.log(
        `   Encontrado ${outOfRange.length} valores fora do intervalo:`,
      );
      outOfRange.slice(0, 5).forEach((d) => {
        console.log(`   - ${d.toFixed(2)} min`);
      });
    }
  } else {
    console.log("⚠️  Nenhuma transição detectada durante o teste");
  }

  process.exit(stayDurations.length === 0 || stayDurations.some((d) => d < 30 || d > 361) ? 1 : 0);
}, 60000);

process.on("SIGINT", () => {
  console.log("\n\n⛔ Teste interrompido");
  publisher.stop();
  process.exit(1);
});
