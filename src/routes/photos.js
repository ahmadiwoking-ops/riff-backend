const prisma = require('../db');
async function photoRoutes(app) {
  app.post('/upload-url', { preHandler: [app.authenticate] }, async (request) => {
    const key = 'photos/' + request.user.id + '/' + Date.now() + '.jpg';
    return { uploadUrl: '/uploads/' + key, s3Key: key };
  });
  app.post('/uploaded', { preHandler: [app.authenticate] }, async (request) => {
    const { s3Key, purpose } = request.body;
    const photo = await prisma.photo.create({ data: { userId: request.user.id, s3Key, purpose } });
    return { photo };
  });
}
module.exports = photoRoutes;
