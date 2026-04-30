# Trabalho

Simulador de estacionamento inteligente em Node.js com 90 vagas (3 setores), eventos MQTT e persistencia em SQLite.

## Visao geral

- 90 sensores (A-01..A-30, B-01..B-30, C-01..C-30)
- 3 gateways (um por setor)
- simulacao de ocupacao/livre com horarios de pico
- injecao de falhas de sensor via API HTTP
- eventos MQTT obrigatorios
- persistencia em SQLite

## Estrutura de setores

| Setor | Vagas |
|---|---|
| A | A-01 ate A-30 |
| B | B-01 ate B-30 |
| C | C-01 ate C-30 |

## Como executar

### 1. API HTTP (necessario para curl /fault)

```bash
npm start
```

API disponivel em `http://localhost:3000`.

Teste rapido:

```bash
curl http://localhost:3000/health
```

### 2. Demo Publisher + Subscriber

```bash
npm run demo
```

Importante:
- `npm run demo` nao sobe a API HTTP.
- `npm start` e `npm run demo` rodam simulacoes separadas.
- falhas enviadas para a API afetam apenas a simulacao da API.

### 3. Publisher e Subscriber separados

```bash
# Terminal 1
npm run publisher

# Terminal 2
npm run subscriber
```

### 4. Docker

```bash
docker compose up --build
```

Depois acesse:
- `http://localhost:3000/health`
- `http://localhost:3000/status`
- `http://localhost:3000/events`

## API HTTP

### Endpoints principais

- `GET /health`
- `GET /layout`
- `GET /status`
- `GET /events`
- `GET /sensors`
- `GET /sensors/:id`
- `POST /sensors/:id/fault`
- `DELETE /sensors/:id/fault`
- `POST /faults`
- `DELETE /faults`

### Consultar sensores

```bash
curl http://localhost:3000/sensors
curl "http://localhost:3000/sensors?sector=A"
curl "http://localhost:3000/sensors?state=OCCUPIED"
curl http://localhost:3000/sensors/A-01
```

### Injetar falha (comando correto)

Use aspas simples no JSON para evitar erro de parsing no shell:

```bash
curl -X POST http://localhost:3000/sensors/A-01/fault \
  -H "content-type: application/json" \
  -d '{"mode":"flapping","durationMinutes":5}'
```

Outros modos:

```bash
curl -X POST http://localhost:3000/sensors/A-01/fault \
  -H "content-type: application/json" \
  -d '{"mode":"stuck_occupied"}'

curl -X POST http://localhost:3000/sensors/A-01/fault \
  -H "content-type: application/json" \
  -d '{"mode":"stuck_free"}'
```

Remover falha:

```bash
curl -X DELETE http://localhost:3000/sensors/A-01/fault
```

Falha por setor:

```bash
curl -X POST http://localhost:3000/faults \
  -H "content-type: application/json" \
  -d '{"sector":"A","mode":"stuck_occupied"}'
```

## MQTT obrigatorio

### Topicos

- eventos de vaga:
  - `campus/parking/sectors/<sectorId>/spots/<spotId>/events`
- status do gateway:
  - `campus/parking/sectors/<sectorId>/gateway/status`

### Payload minimo (evento de vaga)

```json
{
  "eventId": "uuid",
  "ts": "2026-04-29T10:15:30.000Z",
  "sectorId": "A",
  "spotId": "A-07",
  "state": "OCCUPIED",
  "source": "sensor"
}
```

### Regras de ingestao

- backend idempotente por `eventId`
- atualiza estado atual da vaga
- grava historico de eventos

## Banco de dados SQLite

Arquivo padrao:
- `data/parking.sqlite`

Configuracao por variavel:
- `PARKING_DB_PATH` (ex.: `PARKING_DB_PATH=data/parking.sqlite npm start`)

Tabelas persistidas:
- `spots` (estado atual)
- `spot_events` (historico de eventos de vaga)
- `sector_snapshots` (agregado por minuto)
- `incidents` (falhas abertas/fechadas)
- `recommendations_log` (recomendacoes por balanceamento)

### Consultas uteis

Contagem por tabela:

```bash
node -e 'const Database=require("better-sqlite3"); const db=new Database("data/parking.sqlite"); const tables=["spots","spot_events","sector_snapshots","incidents","recommendations_log"]; for (const t of tables){ const c=db.prepare(`SELECT COUNT(*) as n FROM ${t}`).get().n; console.log(`${t}: ${c}`);} db.close();'
```

Ultimos eventos de vaga:

```bash
node -e 'const Database=require("better-sqlite3"); const db=new Database("data/parking.sqlite"); const rows=db.prepare("SELECT eventId, ts, sectorId, spotId, state FROM spot_events ORDER BY ts DESC, rowid DESC LIMIT 15").all(); console.table(rows); db.close();'
```

Ultimos incidentes:

```bash
node -e 'const Database=require("better-sqlite3"); const db=new Database("data/parking.sqlite"); const rows=db.prepare("SELECT id, tsOpen, tsClose, type, severity, sectorId, spotId, status FROM incidents ORDER BY tsOpen DESC LIMIT 20").all(); console.table(rows); db.close();'
```

## Variaveis de ambiente

- `PORT` (padrao `3000`)
- `SIM_MINUTES_PER_SECOND` (padrao `10`)
- `MQTT_URL` (padrao no compose: `mqtt://broker:1883`)
- `PARKING_DB_PATH` (padrao `data/parking.sqlite`)
- `SIM_URL` (usada no CLI `npm run sensor`)

## Testes

```bash
npm test
```

## Observacoes de troubleshooting

- Erro `curl: (7) Failed to connect`: API nao esta rodando. Rode `npm start`.
- Erro `bad_request` com JSON: problema de aspas no `-d` do curl.
- Se usar `npm run demo`, nao espere que os endpoints HTTP reflitam essa mesma instancia.
