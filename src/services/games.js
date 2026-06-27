const CONTENT = {
  // ═══ 5 DEMO GAMES (available to all) ═══
  would_you_rather: {
    rounds: [
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
      { a: 'Always have to say what you feel', b: 'Never be able to express your emotions out loud' },
    ],
  },
  two_truths: {
    prompts: [
      'Share two truths and one lie about your childhood friendships',
      'Two truths and a lie about your most embarrassing moment with a friend',
      'Two truths and a lie about things you have done to impress someone',
      'Two truths and a lie about your guilty pleasures',
      'Two truths and a lie about your biggest fears',
      'Two truths and a lie about a time you surprised yourself',
      'Two truths and a lie about your hidden talents',
      'Two truths and a lie about risks you have taken',
      'Two truths and a lie about your first impressions of people',
      'Two truths and a lie about promises you have kept or broken',
    ],
  },
  hot_takes: {
    statements: [
      'You can tell everything about a person by how they treat waiters.',
      'Long-distance friendships are stronger than local ones.',
      'Everyone has a friendship deal-breaker they never talk about.',
      'You should always be honest even if it hurts someone.',
      'People who say they have no regrets are lying to themselves.',
      'Jealousy between friends is natural and not always toxic.',
      'You can only truly know someone after you have argued with them.',
      'Social media has made friendships more shallow.',
      'Forgiveness without an apology is strength, not weakness.',
      'Your closest friends should be allowed to call you out publicly.',
      'Some friendships are meant to end and that is okay.',
      'You can never have more than three truly close friends at once.',
      'Crying in front of someone is the ultimate act of trust.',
      'White lies are necessary for any relationship to survive.',
      'The friends you make after 25 are the ones that actually last.',
    ],
  },
  this_or_that: {
    pairs: [
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
      ['Laugh together', 'Cry together'],
      ['Old friends who know everything', 'New friends who see you fresh'],
      ['Adventure holiday together', 'Cosy weekend in'],
      ['Send memes', 'Send long messages'],
      ['Be the listener', 'Be the storyteller'],
      ['Trust slowly', 'Trust quickly'],
    ],
  },
  desert_island: {
    scenarios: [
      'You are stranded with your circle. Each person picks one survival skill to contribute. What is yours?',
      'You can only bring three personal items. What do you bring and why?',
      'You find supplies to build one thing. What does the group build first?',
      'A rescue boat arrives but can only take two people. How does the group decide?',
      'You discover a hidden cave with one mysterious object inside. What is it?',
      'Each person gets to send one message home. What does yours say?',
      'You have been on the island for a month. What do you miss most about normal life?',
      'You can have one meal delivered to the island. What does the group order?',
      'Night falls and you need to tell a story around the fire. What story do you tell?',
      'A genie on the island grants the group one collective wish. What do you wish for?',
    ],
  },

  // ═══ 3 SUBSCRIBER-ONLY GAMES ═══
  deeper_questions: {
    questions: [
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
  },
  scenario_challenge: {
    scenarios: [
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
    ],
  },
  memory_lane: {
    prompts: [
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
    ],
  },
};

function generateGame(type) {
  var content = CONTENT[type];
  if (!content) return { question: 'Share something the group does not know about you yet.', type: 'open' };

  if (type === 'would_you_rather') {
    var round = content.rounds[Math.floor(Math.random() * content.rounds.length)];
    return { question: 'Would you rather...', options: [round.a, round.b], type: 'choice' };
  }
  if (type === 'two_truths') {
    var prompt = content.prompts[Math.floor(Math.random() * content.prompts.length)];
    return { question: prompt, type: 'open', instruction: 'Share your two truths and one lie. Others will guess which is the lie!' };
  }
  if (type === 'hot_takes') {
    var statement = content.statements[Math.floor(Math.random() * content.statements.length)];
    return { question: statement, options: ['Strongly agree', 'Agree', 'Disagree', 'Strongly disagree'], type: 'opinion' };
  }
  if (type === 'this_or_that') {
    var pair = content.pairs[Math.floor(Math.random() * content.pairs.length)];
    return { question: 'Pick one and explain why:', options: [pair[0], pair[1]], type: 'choice' };
  }
  if (type === 'desert_island') {
    var scenario = content.scenarios[Math.floor(Math.random() * content.scenarios.length)];
    return { question: scenario, type: 'open' };
  }
  if (type === 'deeper_questions') {
    var q = content.questions[Math.floor(Math.random() * content.questions.length)];
    return { question: q, type: 'open', instruction: 'Take your time with this one. Be as honest as you are comfortable with.' };
  }
  if (type === 'scenario_challenge') {
    var sc = content.scenarios[Math.floor(Math.random() * content.scenarios.length)];
    return { question: sc, type: 'open', instruction: 'There is no right answer. Share what you would genuinely do and why.' };
  }
  if (type === 'memory_lane') {
    var mp = content.prompts[Math.floor(Math.random() * content.prompts.length)];
    return { question: mp, type: 'open', instruction: 'Share a real memory. The more specific the better.' };
  }
  return { question: 'Share something the group does not know about you yet.', type: 'open' };
}

module.exports = { generateGame, CONTENT };
