var PLAN_LIMITS = {
  free:           { deepConnections: 1, circles: 1 },
  explorer:       { deepConnections: 2, circles: 3 },
  inner_circle:   { deepConnections: -1, circles: -1 },
  bot_connection: { deepConnections: 0, circles: 0 },
};

function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

module.exports = { PLAN_LIMITS, getLimits };
