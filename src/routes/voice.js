const prisma = require('../db');
async function voiceRoutes(app) {
  app.post('/upload-url', { preHandler: [app.authenticate] }, async (request) => {
    const key = 'voice/' + request.user.id + '/' + Date.now() + '.opus';
    return { uploadUrl: '/uploads/' + key, s3Key: key };
  });
  app.post('/sent', { preHandler: [app.authenticate] }, async (request) => {
    const { connectionId, s3Key, duration } = request.body;
    const vm = await prisma.voiceMessage.create({ data: { connectionId, senderId: request.user.id, s3Key, duration } });
    return { voiceMessage: vm };
  });
  app.post('/score', { preHandler: [app.authenticate] }, async (request) => {
    const { connectionId, voiceMessageId, scoredId, madeSmile, feltGenuine, wantMore } = request.body;
    const average = (madeSmile + feltGenuine + wantMore) / 3;
    const score = await prisma.voiceScore.create({ data: { connectionId, voiceMessageId, scorerId: request.user.id, scoredId, madeSmile, feltGenuine, wantMore, average } });
    return { score };
  });
}
module.exports = voiceRoutes;
