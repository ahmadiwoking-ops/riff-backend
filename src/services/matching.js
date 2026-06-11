const prisma = require('../db');
async function calculateCompatibility(userAId, userBId) {
  const questions = await prisma.question.findMany({ where: { isActive: true } });
  const [answersA, answersB] = await Promise.all([prisma.questionAnswer.findMany({ where: { userId: userAId } }), prisma.questionAnswer.findMany({ where: { userId: userBId } })]);
  const mapA = Object.fromEntries(answersA.map(a => [a.questionId, a.value]));
  const mapB = Object.fromEntries(answersB.map(a => [a.questionId, a.value]));
  let totalWeight = 0, totalScore = 0;
  for (const q of questions) {
    if (!mapA[q.id] || !mapB[q.id]) continue;
    totalWeight += q.weight;
    totalScore += q.weight * (mapA[q.id] === mapB[q.id] ? 100 : 30);
  }
  return { score: totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0 };
}
module.exports = { calculateCompatibility };
