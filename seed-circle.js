const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function seed() {
  const bots = [];
  const names = [
    { alias: 'Sage', email: 'sage@riff-bot.test', gender: 'Female' },
    { alias: 'Milo', email: 'milo@riff-bot.test', gender: 'Male' },
    { alias: 'Zara', email: 'zara@riff-bot.test', gender: 'Female' },
  ];
  for (const n of names) {
    let u = await p.user.findFirst({ where: { email: n.email } });
    if (!u) {
      u = await p.user.create({ data: { email: n.email, alias: n.alias, age: 25, gender: n.gender, seekingGender: 'No preference', connectionType: 'circle', passwordHash: 'bot-no-login', trustScore: 'green' } });
    }
    bots.push(u);
  }
  const circle = await p.circle.create({ data: { name: 'The Vibe Crew', stage: 'chatting', currentRound: 0 } });
  const yourId = 'cmqptq8om0000eflgqluqt0cp';
  await p.circleMember.create({ data: { circleId: circle.id, userId: yourId, alias: 'Player One' } });
  for (const b of bots) {
    await p.circleMember.create({ data: { circleId: circle.id, userId: b.id, alias: b.alias } });
  }
  const msgs = [
    { senderId: bots[0].id, content: 'hey everyone! excited to be here' },
    { senderId: bots[1].id, content: 'yo! same. this is gonna be fun' },
    { senderId: bots[2].id, content: 'hiii! love that we are doing this' },
  ];
  for (const m of msgs) {
    await p.message.create({ data: { circleId: circle.id, senderId: m.senderId, content: m.content, type: 'text' } });
  }
  console.log('Circle created:', circle.id, circle.name);
  console.log('Members: You + ' + bots.map(b => b.alias).join(', '));
  console.log('Stage: chatting');
  console.log('Messages seeded: 3');
  await p.$disconnect();
}
seed().catch(e => { console.error(e); process.exit(1); });
