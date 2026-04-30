const baseUrl = process.env.SIM_URL || "http://localhost:3000";
const [, , sensorId, ...args] = process.argv;

const STATE_LABELS = {
  FREE: "LIVRE",
  OCCUPIED: "OCUPADO",
};

const FAULT_LABELS = {
  stuck_occupied: "TRAVADO_OCUPADO",
  stuck_free: "TRAVADO_LIVRE",
  flapping: "PISCANDO",
};

const FAULT_ALIASES = {
  travado_ocupado: "stuck_occupied",
  travado_livre: "stuck_free",
  piscando: "flapping",
  stuck_occupied: "stuck_occupied",
  stuck_free: "stuck_free",
  flapping: "flapping",
};

function translateFaultName(fault) {
  return FAULT_LABELS[fault] || fault || "nenhuma";
}

function translateState(state) {
  return STATE_LABELS[state] || state || "desconhecido";
}

function printUsage() {
  console.log([
    "Uso:",
    "  npm run sensor -- A-01",
    "  npm run sensor -- A-01 --falha travado_ocupado",
    "  npm run sensor -- A-01 --limpar",
    "",
    "Variável opcional:",
    "  SIM_URL=http://localhost:3000",
  ].join("\n"));
}

function parseArgs(rawArgs) {
  const options = { fault: null, clear: false };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--fault" || arg === "--falha") {
      const faultName = rawArgs[index + 1];
      options.fault = FAULT_ALIASES[faultName] || faultName;
      index += 1;
      continue;
    }

    if (arg === "--clear" || arg === "--limpar") {
      options.clear = true;
      continue;
    }
  }

  return options;
}

async function main() {
  if (!sensorId || sensorId === "--help" || sensorId === "-h") {
    printUsage();
    process.exitCode = sensorId ? 0 : 1;
    return;
  }

  const options = parseArgs(args);

  if (options.clear && options.fault) {
    console.error("Use apenas --falha ou --limpar por vez.");
    process.exitCode = 1;
    return;
  }

  const getResponse = await fetch(`${baseUrl}/sensors/${sensorId}`);
  if (!getResponse.ok) {
    console.error(`Sensor ${sensorId} não encontrado. HTTP ${getResponse.status}`);
    process.exitCode = 1;
    return;
  }

  const sensorData = await getResponse.json();

  if (options.fault) {
    const faultResponse = await fetch(`${baseUrl}/sensors/${sensorId}/fault`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: options.fault }),
    });

    const payload = await faultResponse.json();
    const sensor = payload.sensor || {};
    console.log([
      `Sensor: ${sensor.id || sensorId}`,
      `Setor: ${sensor.sector || sensorData.sensor.sector}`,
      `Estado: ${translateState(sensor.state || sensorData.sensor.state)}`,
      `Falha aplicada: ${translateFaultName(sensor.fault)}`,
    ].join("\n"));
    return;
  }

  if (options.clear) {
    const clearResponse = await fetch(`${baseUrl}/sensors/${sensorId}/fault`, {
      method: "DELETE",
    });

    const payload = await clearResponse.json();
    console.log([
      `Sensor: ${sensorData.sensor.id}`,
      `Setor: ${sensorData.sensor.sector}`,
      "Falha: removida",
      `Código limpo: ${Array.isArray(payload.cleared) ? payload.cleared.join(", ") : "nenhum"}`,
    ].join("\n"));
    return;
  }

  const payload = sensorData;
  const sensor = payload.sensor;
  console.log([
    `Sensor: ${sensor.id}`,
    `Setor: ${sensor.sector}`,
    `Vaga: ${sensor.spotNumber.toString().padStart(2, "0")}`,
    `Estado: ${translateState(sensor.state)}`,
    `Falha: ${translateFaultName(sensor.fault)}`,
    `Última alteração: ${sensor.lastChangeAt}`,
    `Próxima chegada: ${sensor.nextArrivalAt || "sem previsão"}`,
    `Ocupado até: ${sensor.occupiedUntil || "sem previsão"}`,
  ].join("\n"));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});