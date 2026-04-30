import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Demo: Inicia Publisher e Subscriber em paralelo
 */

console.log("🎬 Iniciando Demo - Publisher + Subscriber\n");

const publisherProcess = spawn("node", [path.join(__dirname, "publisher.js")], {
  stdio: "inherit",
});

// Aguardar um pouco para o publisher estar pronto
await new Promise((resolve) => setTimeout(resolve, 1000));

const subscriberProcess = spawn("node", [path.join(__dirname, "subscriber.js")], {
  stdio: "inherit",
});

// Tratamento de sinais de parada
const cleanup = () => {
  console.log("\n\n⛔ Parando processos...");
  publisherProcess.kill();
  subscriberProcess.kill();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Detectar quando algum processo morre
publisherProcess.on("exit", (code) => {
  console.log(`\n📦 Publisher finalizado com código ${code}`);
  subscriberProcess.kill();
  process.exit(code || 0);
});

subscriberProcess.on("exit", (code) => {
  console.log(`\n🔔 Subscriber finalizado com código ${code}`);
  publisherProcess.kill();
  process.exit(code || 0);
});
