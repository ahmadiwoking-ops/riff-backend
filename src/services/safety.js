const FLAGS = [
  { type: 'underage', severity: 'critical', patterns: [/\b(i'?m|i am)\s+(1[0-7]|[1-9])\s*(years?\s*old|yo)\b/i, /\b(in|at)\s+(middle|high)\s*school\b/i] },
  { type: 'predatory', severity: 'critical', patterns: [/\b(young|underage|minor)\s*(girl|boy|kid)\b/i, /\bdon'?t\s+tell\s+(anyone|your\s+parents?)\b/i] },
  { type: 'illegal', severity: 'critical', patterns: [/\b(sell|buy|deal)\s+(drugs?|weed|coke|meth)\b/i, /\b(kill|murder|bomb)\s+(someone|people)\b/i] },
  { type: 'harassment', severity: 'high', patterns: [/\b(kill|hurt|rape)\s+(you|yourself)\b/i, /\b(send|show)\s+(nudes?|naked)\b/i] },
  { type: 'crisis', severity: 'critical', patterns: [/\b(want\s+to|going\s+to)\s+(die|kill\s+my\s*self|end\s+it)\b/i, /\bsuicid/i] },
  { type: 'solicitation', severity: 'medium', patterns: [/\b(check\s+out|visit)\s+(my|this)\s+(website|link)\b/i] },
];
function scanMessage(content) {
  if (!content) return null;
  for (const cat of FLAGS) for (const p of cat.patterns) if (p.test(content)) return { type: cat.type, severity: cat.severity };
  return null;
}
module.exports = { scanMessage };
