const CONTENT = {
  wyr: { rounds: [{ a: 'Know every language but never travel', b: 'Travel everywhere but only your native language' }, { a: 'Always know when someone is lying', b: 'Always get away with lying' }] },
  hot_take: { statements: ["It's okay to read someone's messages if you suspect lying.", "Being brutally honest is overrated."] },
  this_that: { pairs: [['Morning', 'Night'], ['Call', 'Text'], ['Mountains', 'Beach'], ['Plan', 'Wing it']] },
  personality: { questions: [{ q: "At a party you...", opts: ['Deep talk with one person', 'Float between groups', 'Bond with the pet', 'Organise a game'] }] },
  rank: { items: ['Honesty', 'Reliability', 'Humor', 'Loyalty', 'Acceptance'] },
  scenario: { scenarios: ['You find a time machine. Visit any moment for 24 hours. Where?'] },
  trivia: { note: 'Generated from conversations' },
  story: { starters: ['I woke up and my cat was wearing sunglasses.'] },
};
function generateGame(type) { return CONTENT[type] || {}; }
module.exports = { generateGame };
