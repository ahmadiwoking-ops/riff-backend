// ═══ GAME CONTENT — generates non-repeating questions ═══

var CONTENT = {
  would_you_rather: [
    { a: 'Know what everyone really thinks of you', b: 'Never know but always be liked' },
    { a: 'Have one deep friendship that lasts forever', b: 'Have many good friendships that come and go' },
    { a: 'Always know when someone is lying to you', b: 'Always get away with lying to others' },
    { a: 'Relive your best memory on repeat', b: 'Fast forward to your happiest future moment' },
    { a: 'Be the funniest person in the room', b: 'Be the wisest person in the room' },
    { a: 'Only communicate through voice notes', b: 'Only communicate through handwritten letters' },
    { a: 'Know every language but never travel', b: 'Travel everywhere but only speak your own language' },
    { a: 'Have a friend who is brutally honest', b: 'Have a friend who always spares your feelings' },
    { a: 'Live in a world with no secrets', b: 'Live in a world where everyone keeps one big secret' },
    { a: 'Be famous but lonely', b: 'Be unknown but deeply loved' },
    { a: 'Give up your phone for a year', b: 'Give up seeing friends in person for a year' },
    { a: 'Always say what you feel', b: 'Never be able to express your emotions out loud' },
    { a: 'Have dinner with your future self', b: 'Have dinner with your 10-year-old self' },
    { a: 'Read everyone\'s mind for a day', b: 'Be invisible for a day' },
    { a: 'Lose all your memories but keep your personality', b: 'Lose your personality but keep your memories' },
  ],
  two_truths: [
    'Share two truths and one lie about your childhood friendships',
    'Two truths and a lie about your most embarrassing moment',
    'Two truths and a lie about things you have done to impress someone',
    'Two truths and a lie about your guilty pleasures',
    'Two truths and a lie about your biggest fears',
    'Two truths and a lie about a time you surprised yourself',
    'Two truths and a lie about your hidden talents',
    'Two truths and a lie about risks you have taken',
    'Two truths and a lie about your first impressions of people in this group',
    'Two truths and a lie about promises you have kept or broken',
    'Two truths and a lie about food you love or hate',
    'Two truths and a lie about your weekend habits',
    'Two truths and a lie about places you have been',
    'Two truths and a lie about your dream life',
    'Two truths and a lie about things that make you cry',
  ],
  hot_takes: [
    'You can tell everything about a person by how they treat waiters.',
    'Long-distance friendships are stronger than local ones.',
    'Everyone has a friendship deal-breaker they never talk about.',
    'You should always be honest even if it hurts someone.',
    'People who say they have no regrets are lying to themselves.',
    'Jealousy between friends is natural and not always toxic.',
    'You can only truly know someone after you have argued with them.',
    'Social media has made friendships more shallow.',
    'Forgiveness without an apology is strength not weakness.',
    'Your closest friends should be allowed to call you out publicly.',
    'Some friendships are meant to end and that is okay.',
    'You can never have more than three truly close friends at once.',
    'Crying in front of someone is the ultimate act of trust.',
    'White lies are necessary for any relationship to survive.',
    'The friends you make after 25 are the ones that actually last.',
  ],
  this_or_that: [
    ['Deep talk at midnight', 'Silly fun in the afternoon'],
    ['Phone call', 'Voice note'],
    ['Big group energy', 'One-on-one catch-up'],
    ['Plan everything', 'See what happens'],
    ['Give advice', 'Just listen'],
    ['Confront problems immediately', 'Sleep on it first'],
    ['Forgive quickly', 'Take your time'],
    ['Share everything', 'Keep some things private'],
    ['Lead the group', 'Go with the flow'],
    ['Comfort through words', 'Comfort through actions'],
    ['Honest but blunt', 'Kind but vague'],
    ['Text first', 'Wait for them to text'],
    ['Talk about feelings', 'Show through gestures'],
    ['Stay up all night talking', 'Wake up early for breakfast together'],
    ['Old friends who know everything', 'New friends who see you fresh'],
  ],
  desert_island: [
    'You are stranded with your circle. Each person picks one survival skill to contribute. What is yours?',
    'You can only bring three personal items. What do you bring and why?',
    'You find supplies to build one thing. What does the group build first?',
    'A rescue boat arrives but can only take two people. How does the group decide?',
    'You discover a hidden cave with one mysterious object inside. What is it?',
    'Each person gets to send one message home. What does yours say?',
    'You have been on the island for a month. What do you miss most about normal life?',
    'You can have one meal delivered to the island. What does the group order?',
    'Night falls and you need to tell a story around the fire. What is the story about?',
    'A genie on the island grants the group one collective wish. What do you wish for?',
    'You find a working radio with one channel. What do you tune into?',
    'Roles need to be assigned: leader, cook, builder, lookout. Which do you choose?',
    'A mysterious stranger arrives on a raft. Do you trust them?',
    'You find a journal from a previous castaway. What does the last entry say?',
    'After a year on the island, rescue finally comes. What is the first thing you do back in civilisation?',
  ],
  deeper_questions: [
    'What is something you have never told anyone in this group?',
    'When did you last feel truly understood by someone?',
    'What is a belief you held strongly that completely changed?',
    'What do you think people misunderstand about you most?',
    'What is the kindest thing a stranger ever did for you?',
    'If you could fix one thing about how you communicate, what would it be?',
    'What moment in your life shaped who you are today more than any other?',
    'What are you most afraid of losing?',
    'When do you feel most like yourself?',
    'What is something you wish you could say to someone but never have?',
    'What is your emotional safe place?',
    'What do you need most from the people closest to you?',
    'What has friendship taught you that nothing else could?',
    'When was the last time you changed your mind about someone?',
    'What do you want people to remember about you?',
  ],
  scenario_challenge: [
    'Your best friend tells you they are about to make a huge mistake. They have not asked for your opinion. What do you do?',
    'You overhear someone talking negatively about a member of your circle. Do you say something?',
    'A friend cancels on you for the third time in a row. How do you handle it?',
    'Someone in the group shares a secret with you and asks you not to tell the others. Then it comes up in conversation. What do you do?',
    'You and a friend both apply for the same opportunity. You get it, they do not. How do you navigate that?',
    'A friend is going through something hard but insists they are fine. Do you push or give space?',
    'You realise you have been the toxic one in a past friendship. What do you do about it now?',
    'Someone you care about ghosts you. Weeks later they reach out like nothing happened. How do you respond?',
    'A friend asks you to be honest about something they did. You know the truth will hurt. What do you say?',
    'You have grown apart from someone you once considered your closest friend. Do you try to rebuild or let it go?',
    'A member of the group accidentally reveals something personal about another member. How does the group handle it?',
    'You find out a friend has been struggling financially but hiding it. Do you offer help or wait for them to ask?',
    'Two of your friends are in a conflict and both want you to take their side. What do you do?',
    'You catch a friend lying about something small. Do you confront them or let it go?',
    'A friend makes a joke at your expense in front of the group. It stings. What do you do?',
  ],
  memory_lane: [
    'Describe a moment when a friend made you feel truly seen.',
    'What is the funniest thing that has ever happened in a group chat?',
    'Share a time when someone showed up for you when you least expected it.',
    'What is the best piece of advice a friend ever gave you?',
    'Describe a moment when you knew a friendship was going to last.',
    'What is the most spontaneous thing you have ever done with friends?',
    'Share a time when you had to apologise to a friend. What happened?',
    'What is a friendship tradition you love or wish you had?',
    'Describe the moment you met someone who became important to you.',
    'What is a small gesture from a friend that meant more than they will ever know?',
    'Share a time when a friend challenged you to be better.',
    'What is the longest you have gone without talking to a close friend, and what brought you back together?',
    'Describe your perfect day spent with friends.',
    'What is a lesson you learned the hard way about friendship?',
    'Share a memory that still makes you smile every time you think of it.',
  ],
};

// Shuffle array (Fisher-Yates)
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var temp = a[i]; a[i] = a[j]; a[j] = temp;
  }
  return a;
}

// Generate all rounds for a game upfront — no repeats
function generateAllRounds(type, count) {
  var pool = CONTENT[type];
  if (!pool || pool.length === 0) return [];
  var shuffled = shuffle(pool);
  var rounds = [];
  for (var i = 0; i < count && i < shuffled.length; i++) {
    rounds.push(formatRound(type, shuffled[i]));
  }
  return rounds;
}

// Format a single round based on game type
function formatRound(type, item) {
  if (type === 'would_you_rather') {
    return { question: 'Would you rather...', options: [item.a, item.b], type: 'choice' };
  }
  if (type === 'two_truths') {
    return { question: item, type: 'open', instruction: 'Share your two truths and one lie. Others will guess which is the lie!' };
  }
  if (type === 'hot_takes') {
    return { question: item, options: ['Strongly agree', 'Agree', 'Disagree', 'Strongly disagree'], type: 'opinion' };
  }
  if (type === 'this_or_that') {
    return { question: 'Pick one and explain why:', options: [item[0], item[1]], type: 'choice' };
  }
  if (type === 'desert_island') {
    return { question: item, type: 'open' };
  }
  if (type === 'deeper_questions') {
    return { question: item, type: 'open', instruction: 'Take your time. Be as honest as you are comfortable with.' };
  }
  if (type === 'scenario_challenge') {
    return { question: item, type: 'open', instruction: 'No right answer. Share what you would genuinely do and why.' };
  }
  if (type === 'memory_lane') {
    return { question: item, type: 'open', instruction: 'Share a real memory. The more specific the better.' };
  }
  return { question: String(item), type: 'open' };
}

// Generate a single round (used for backward compat)
function generateGame(type) {
  var pool = CONTENT[type];
  if (!pool || pool.length === 0) return { question: 'Share something the group does not know about you.', type: 'open' };
  var item = pool[Math.floor(Math.random() * pool.length)];
  return formatRound(type, item);
}

module.exports = { generateGame, generateAllRounds, CONTENT };
