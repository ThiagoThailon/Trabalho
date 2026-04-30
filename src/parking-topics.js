export const MQTT_BASE_TOPIC = "campus/parking";

export function buildSpotEventsTopic(sectorId, spotId) {
  return `${MQTT_BASE_TOPIC}/sectors/${sectorId}/spots/${spotId}/events`;
}

export function buildGatewayStatusTopic(sectorId) {
  return `${MQTT_BASE_TOPIC}/sectors/${sectorId}/gateway/status`;
}

export function isSpotEventsTopic(topic) {
  return /^campus\/parking\/sectors\/[^/]+\/spots\/[^/]+\/events$/.test(topic);
}

export function isGatewayStatusTopic(topic) {
  return /^campus\/parking\/sectors\/[^/]+\/gateway\/status$/.test(topic);
}

export function parseSpotEventsTopic(topic) {
  const match = topic.match(/^campus\/parking\/sectors\/([^/]+)\/spots\/([^/]+)\/events$/);
  if (!match) {
    return null;
  }

  return { sectorId: match[1], spotId: match[2] };
}

export function parseGatewayStatusTopic(topic) {
  const match = topic.match(/^campus\/parking\/sectors\/([^/]+)\/gateway\/status$/);
  if (!match) {
    return null;
  }

  return { sectorId: match[1] };
}