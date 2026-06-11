const prisma = require('../db');
async function questionRoutes(app) {
  app.get('/', { preHandler: [app.authenticate] }, async (request) => {
    const userId = request.user.id;
    const answered = await prisma.questionAnswer.findMany({ where: { userId }, select: { questionId: true } });
    const answeredIds = answered.map(a => a.questionId);
    const questions = await prisma.question.findMany({ where: { isActive: true, id: { notIn: answeredIds } }, orderBy: { sortOrder: 'asc' } });
    const totalCount = await prisma.question.count({ where: { isActive: true } });
    return { questions, answeredCount: answeredIds.length, totalCount };
  });

  app.post('/answer', { preHandler: [app.authenticate] }, async (request) => {
    const { questionId, optionId, value } = request.body;
    const answer = await prisma.questionAnswer.upsert({
      where: { userId_questionId: { userId: request.user.id, questionId } },
      update: { optionId, value }, create: { userId: request.user.id, questionId, optionId, value },
    });
    const totalQuestions = await prisma.question.count({ where: { isActive: true } });
    const userAnswers = await prisma.questionAnswer.count({ where: { userId: request.user.id } });
    return { answer, progress: { answered: userAnswers, total: totalQuestions, complete: userAnswers >= totalQuestions } };
  });
}
module.exports = questionRoutes;
