// === SIMULADOR DE ESTACIONAMENTO INTELIGENTE ===
// 90 sensores (1 por vaga) + 3 gateways (1 por setor)

// Configuração de Setores
export const SECTORS = ["A", "B", "C"]; // 3 setores
export const SPOTS_PER_SECTOR = 30;   // 30 vagas por setor = 90 vagas totais
export const SIMULATION_MINUTES_PER_SECOND = Number(process.env.SIM_MINUTES_PER_SECOND || 10);
export const HTTP_PORT = Number(process.env.PORT || 3000);

// Horários de Pico
// - Manhã: 7h às 10h (chegadas 2.4x mais frequentes)
// - Fim de tarde: 16h às 19h (chegadas 2.8x mais frequentes)
export const PEAK_WINDOWS = [
  { start: 7 * 60, end: 10 * 60, multiplier: 2.4 },   // Pico matutino
  { start: 16 * 60, end: 19 * 60, multiplier: 2.8 },  // Pico vespertino
];

// Tempo de Permanência: 30 minutos a 6 horas (em tempo simulado)
export const BASE_ARRIVAL_INTERVAL_MINUTES = 45;
export const MIN_STAY_MINUTES = 30;
export const MAX_STAY_MINUTES = 6 * 60;
export const FLAPPING_INTERVAL_SECONDS = 5;