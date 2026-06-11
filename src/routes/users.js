const prisma = require('../db');
async function userRoutes(app) {
  app.get('/stats', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    const [deepConns, circles, msgs] = await Promise.all([
      prisma.connection.count({ where: { OR: [{ userAId: userId }, { userBId: userId }], isActive: true, isPractice: false } }),
      prisma.circleMember.count({ where: { userId, isActive: true } }),
      prisma.message.count({ where: { senderId: userId } }),
    ]);
    return { deepConnections: deepConns, circles, messagesSent: msgs };
  });

  app.post('/update-profile', { preHandler: [app.authenticate] }, async (request) => {
    const { alias, age, gender, seekingGender, connectionType } = request.body;
    const updates = {};
    if (alias) updates.alias = alias;
    if (age) updates.age = parseInt(age);
    if (gender) updates.gender = gender;
    if (seekingGender) updates.seekingGender = seekingGender;
    if (connectionType) updates.connectionType = connectionType;
    const user = await prisma.user.update({ where: { id: request.user.id }, data: updates });
    return { user: { id: user.id, alias: user.alias, age: user.age, gender: user.gender, seekingGender: user.seekingGender, connectionType: user.connectionType } };
  });

  app.post('/delete-account', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    await prisma.questionAnswer.deleteMany({ where: { userId } });
    await prisma.message.deleteMany({ where: { senderId: userId } });
    await prisma.voiceScore.deleteMany({ where: { OR: [{ scorerId: userId }, { scoredId: userId }] } });
    await prisma.voiceMessage.deleteMany({ where: { senderId: userId } });
    await prisma.photo.deleteMany({ where: { userId } });
    await prisma.lifeChapter.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId } });
    await prisma.safetyFlag.deleteMany({ where: { userId } });
    await prisma.circleMember.deleteMany({ where: { userId } });
    await prisma.connection.deleteMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
    await prisma.user.delete({ where: { id: userId } });
    return { status: 'deleted' };
  });
}
module.exports = userRoutes;
