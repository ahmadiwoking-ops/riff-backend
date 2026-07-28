const prisma = require('../db');

async function voiceRoutes(app) {
  // Submit a voice score for the connection (simple 1-5 rating)
  app.post('/score', { preHandler: [app.authenticate] }, async (request) => {
    var connectionId = request.body.connectionId;
    var score = parseFloat(request.body.score);
    if (!connectionId || isNaN(score)) return { error: 'connectionId and score required' };

    var conn = await prisma.connection.findUnique({ where: { id: connectionId } });
    if (!conn) return { error: 'Connection not found' };

    var isUserA = conn.userAId === request.user.id;
    // Save this user's score to the correct field
    var updateData = isUserA ? { userAVoiceAvg: score } : { userBVoiceAvg: score };
    var updated = await prisma.connection.update({ where: { id: connectionId }, data: updateData });

    var myScore = isUserA ? updated.userAVoiceAvg : updated.userBVoiceAvg;
    var theirScore = isUserA ? updated.userBVoiceAvg : updated.userAVoiceAvg;

    // Both have scored?
    if (myScore != null && theirScore != null) {
      if (myScore >= 4 && theirScore >= 4) {
        // Both aligned - mark threshold met
        await prisma.connection.update({ where: { id: connectionId }, data: { voiceThresholdMet: true } });
        return { status: 'aligned', message: 'Your scores align — you can progress to the reveal.', myScore: myScore, theirScore: theirScore, bothScored: true, canProceed: true };
      } else {
        return { status: 'not_aligned', message: 'Your scores did not both reach 4/5. You can keep talking or move on.', myScore: myScore, theirScore: theirScore, bothScored: true, canProceed: false };
      }
    }

    // Only this user has scored so far
    return { status: 'waiting', message: 'Rating saved — waiting for ' + (isUserA ? 'their' : 'their') + ' rating.', myScore: myScore, theirScore: null, bothScored: false, canProceed: false };
  });
}
module.exports = voiceRoutes;
