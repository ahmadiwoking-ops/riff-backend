var PLAN_LIMITS = {
  free:           { deepConnections: 1, circles: 0 },  // circles NOT available on free
  single:         { deepConnections: 1, circles: 1 },  // Riff Single (was missing -> fell back to free)
  explorer:       { deepConnections: 2, circles: 3 },
  inner_circle:   { deepConnections: 5, circles: -1 },  // 5 deep connections at a time
  bot_connection: { deepConnections: 0, circles: 0 },
};

function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

module.exports = { PLAN_LIMITS, getLimits };
